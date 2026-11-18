const { assert } = require('chai');
const { withLock, isLocked, projectKey, withProjectLock } = require('./lock');

// a promise resolved by hand
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });

  return { promise, resolve };
};

// let every pending promise callback run (no delay: the next turn of the loop)
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

// a holder of `keys` that records when it enters and leaves, and leaves when
// `gate` is resolved
const holder = (keys, name, order, gate) => withLock(keys, async () => {
  order.push(`${name} in`);
  await gate.promise;
  order.push(`${name} out`);

  return name;
});

// eslint-disable-next-line max-statements
describe('project/lock', () => {
  describe('one key', () => {
    it('runs three holders one at a time, in call order', async () => {
      const order = [];
      const gates = [deferred(), deferred(), deferred()];
      const runs = ['A', 'B', 'C'].map((name, i) => holder('fifo', name, order, gates[i]));
      await flush();
      assert.deepEqual(order, ['A in']);
      // released out of order: each still waits for the one before it
      gates[2].resolve();
      gates[1].resolve();
      await flush();
      assert.deepEqual(order, ['A in']);
      gates[0].resolve();
      assert.deepEqual(await Promise.all(runs), ['A', 'B', 'C']);
      assert.deepEqual(order, ['A in', 'A out', 'B in', 'B out', 'C in', 'C out']);
      assert.isFalse(isLocked('fifo'));
    });

    it('is held while a holder runs, and free after', async () => {
      const gate = deferred();
      const run = holder('held', 'A', [], gate);
      assert.isTrue(isLocked('held'));
      gate.resolve();
      await run;
      assert.isFalse(isLocked('held'));
    });
  });

  describe('a throwing fn', () => {
    for (const [what, fn] of [
      ['sync', () => { throw new Error('boom sync'); }],
      ['async', async () => { await flush(); throw new Error('boom async'); }]
    ]) {
      it(`(${what}) rejects with its error, releases the key, and the next holder runs`, async () => {
        const failing = withLock(['throw', 'throw2'], fn);
        const next = withLock('throw', () => 'next');
        let error;
        try {
          await failing;
        } catch (err) {
          error = err;
        }
        assert.instanceOf(error, Error);
        assert.strictEqual(error.message, `boom ${what}`);
        assert.strictEqual(await next, 'next');
        assert.isFalse(isLocked('throw'));
        assert.isFalse(isLocked('throw2'));
      });
    }
  });

  describe('independent keys', () => {
    it('two keys run at the same time', async () => {
      const order = [];
      const gateX = deferred();
      const gateY = deferred();
      const runX = holder('x', 'X', order, gateX);
      const runY = holder('y', 'Y', order, gateY);
      await flush();
      assert.deepEqual(order, ['X in', 'Y in']);
      // Y finishes while X still holds its key
      gateY.resolve();
      assert.strictEqual(await runY, 'Y');
      assert.deepEqual(order, ['X in', 'Y in', 'Y out']);
      gateX.resolve();
      await runX;
    });
  });

  describe('several keys', () => {
    it('project+mri waits for a holder of mri', async () => {
      const order = [];
      const gateM = deferred();
      const gateB = deferred();
      const runM = holder('mri', 'M', order, gateM);
      const runB = holder(['project', 'mri'], 'B', order, gateB);
      await flush();
      assert.deepEqual(order, ['M in']);
      // it took 'project' after 'mri', in sorted order: 'project' is not held yet
      assert.isTrue(isLocked('mri'));
      gateM.resolve();
      gateB.resolve();
      await Promise.all([runM, runB]);
      assert.deepEqual(order, ['M in', 'M out', 'B in', 'B out']);
      assert.isFalse(isLocked('mri'));
      assert.isFalse(isLocked('project'));
    });

    it('a holder of project waits for project+mri', async () => {
      const order = [];
      const gateB = deferred();
      const gateP = deferred();
      const runB = holder(['project', 'mri'], 'B', order, gateB);
      await flush();
      const runP = holder('project', 'P', order, gateP);
      await flush();
      assert.deepEqual(order, ['B in']);
      gateP.resolve();
      await flush();
      assert.deepEqual(order, ['B in']);
      gateB.resolve();
      await Promise.all([runB, runP]);
      assert.deepEqual(order, ['B in', 'B out', 'P in', 'P out']);
    });

    it('a+b and b+a started together both finish (keys sorted: no deadlock)', async () => {
      const order = [];
      const gate1 = deferred();
      const gate2 = deferred();
      const run1 = holder(['a', 'b'], '1', order, gate1);
      const run2 = holder(['b', 'a'], '2', order, gate2);
      gate1.resolve();
      gate2.resolve();
      assert.deepEqual(await Promise.all([run1, run2]), ['1', '2']);
      assert.deepEqual(order, ['1 in', '1 out', '2 in', '2 out']);
      assert.isFalse(isLocked('a'));
      assert.isFalse(isLocked('b'));
    });

    it('duplicates (a+a) do not deadlock', async () => {
      assert.strictEqual(await withLock(['dup', 'dup'], () => 'once'), 'once');
      assert.isFalse(isLocked('dup'));
    });
  });

  describe('what fn returns', () => {
    it('a value is resolved', async () => {
      assert.deepEqual(await withLock('value', () => ({ n: 1 })), { n: 1 });
    });

    it('a promise is resolved', async () => {
      assert.strictEqual(await withLock('promise', () => Promise.resolve(42)), 42);
    });
  });

  describe('bad keys', () => {
    let missing;
    for (const [what, keys] of [
      ['a number', 3],
      ['undefined', missing],
      ['null', null],
      ['an object', {}],
      ['an empty string', ''],
      ['an empty array', []],
      ['a non-string in an array', ['ok', 4]],
      ['an empty string in an array', ['ok', '']]
    ]) {
      it(`${what} rejects with a TypeError, and fn is not called`, async () => {
        let called = false;
        let error;
        try {
          await withLock(keys, () => { called = true; });
        } catch (err) {
          error = err;
        }
        assert.instanceOf(error, TypeError);
        assert.match(error.message, /^withLock: /);
        assert.isFalse(called);
        assert.isFalse(isLocked('ok'));
      });
    }
  });

  describe('withProjectLock and projectKey', () => {
    it('projectKey is project:<shortname>', () => {
      assert.strictEqual(projectKey('abc'), 'project:abc');
    });

    it('withProjectLock holds project:<shortname>', async () => {
      const order = [];
      const gate = deferred();
      const run = withProjectLock('wpl', async () => {
        order.push('P in');
        await gate.promise;
        order.push('P out');

        return 'done';
      });
      await flush();
      assert.isTrue(isLocked('project:wpl'));
      assert.isFalse(isLocked('wpl'));
      // a plain holder of the same key waits for it
      const plain = withLock('project:wpl', () => { order.push('K'); });
      await flush();
      assert.deepEqual(order, ['P in']);
      gate.resolve();
      assert.strictEqual(await run, 'done');
      await plain;
      assert.deepEqual(order, ['P in', 'P out', 'K']);
      assert.isFalse(isLocked('project:wpl'));
    });
  });

  describe('no leak', () => {
    it('after 100 holders of 10 keys, no key is left', async () => {
      const keys = Array.from({ length: 10 }, (_, i) => `leak${i}`);
      const runs = Array.from({ length: 100 }, (_, i) => {
        // one key, two keys or three keys, in either order; every 7th throws
        const mine = [keys[i % 10], keys[(i * 3) % 10], keys[(i * 7) % 10]].slice(0, (i % 3) + 1);

        return withLock(i % 2 ? mine.reverse() : mine, async () => {
          await flush();
          if (i % 7 === 0) {
            throw new Error('leak');
          }

          return i;
        }).catch(() => -1);
      });
      const results = await Promise.all(runs);
      assert.lengthOf(results, 100);
      assert.strictEqual(results.filter((r) => r === -1).length, 15);
      for (const key of keys) {
        assert.isFalse(isLocked(key), key);
      }
    });
  });
});
