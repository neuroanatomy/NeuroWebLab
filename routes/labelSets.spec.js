const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert } = require('chai');
const sinon = require('sinon');
const { listLabelSets, labelSetsRoute } = require('./labelSets');

const fakeLogger = () => ({ warn: sinon.spy() });

const makeDir = async (files) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nwl-labels-'));
  await Promise.all(Object.entries(files).map(([name, text]) => (text === null
    ? fs.promises.mkdir(path.join(dir, name))
    : fs.promises.writeFile(path.join(dir, name), text))));

  return dir;
};

const set = (name) => JSON.stringify({ name, labels: [] });

describe('routes/labelSets', () => {
  const dirs = [];
  const tmp = async (files) => {
    const dir = await makeDir(files);
    dirs.push(dir);

    return dir;
  };
  after(async () => {
    await Promise.all(dirs.map((d) => fs.promises.rm(d, { recursive: true, force: true })));
  });

  describe('listLabelSets', () => {
    // ported from microdraw's test/api/label-sets.spec.js, "listLabelSets",
    // with microdraw's default first given as `first`
    it('microdraw: lists the valid *.json files, 10regions.json first then by file name, skipping the others', async () => {
      const dir = await tmp({
        'b.json': set('Set B'),
        '10regions.json': set('10 regions'),
        '000.json': set('Set 000'),
        'a.json': set('Set A'),
        'bad.json': '{ not json',
        'noname.json': JSON.stringify({ labels: [] }),
        'null.json': 'null',
        'notes.txt': JSON.stringify({ name: 'not a .json file' }),
        'folder.json': null
      });
      assert.deepEqual(await listLabelSets(dir, { first: '10regions.json', logger: fakeLogger() }), [
        { name: '10 regions', source: '10regions.json' },
        { name: 'Set 000', source: '000.json' },
        { name: 'Set A', source: 'a.json' },
        { name: 'Set B', source: 'b.json' }
      ]);
    });

    it('orders by file name (code point) with no first', async () => {
      const dir = await tmp({ 'b.json': set('B'), 'Z.json': set('Z'), '10regions.json': set('10'), 'a.json': set('A') });
      assert.deepEqual((await listLabelSets(dir)).map((s) => s.source), ['10regions.json', 'Z.json', 'a.json', 'b.json']);
    });

    it('puts first before the others; a first that is not in the folder is ignored', async () => {
      const dir = await tmp({ 'b.json': set('B'), 'c.json': set('C'), 'a.json': set('A') });
      assert.deepEqual((await listLabelSets(dir, { first: 'c.json' })).map((s) => s.source), ['c.json', 'a.json', 'b.json']);
      assert.deepEqual((await listLabelSets(dir, { first: 'missing.json' })).map((s) => s.source), ['a.json', 'b.json', 'c.json']);
    });

    it('ignores files that are not .json, and sub-folders, without logging them', async () => {
      const dir = await tmp({ 'a.json': set('A'), 'notes.txt': set('T'), 'a.json.bak': set('K'), 'sub.json': null, sub: null });
      const logger = fakeLogger();
      assert.deepEqual(await listLabelSets(dir, { logger }), [{ name: 'A', source: 'a.json' }]);
      assert.isFalse(logger.warn.called);
    });

    it('skips invalid JSON, no name, a non-string name and null, each logged once', async () => {
      const dir = await tmp({
        'ok.json': set('OK'),
        'bad.json': '{ not json',
        'noname.json': JSON.stringify({ labels: [] }),
        'numname.json': JSON.stringify({ name: 3, labels: [] }),
        'null.json': 'null'
      });
      const logger = fakeLogger();
      assert.deepEqual(await listLabelSets(dir, { logger }), [{ name: 'OK', source: 'ok.json' }]);
      assert.strictEqual(logger.warn.callCount, 4);
      const logged = logger.warn.args.map(([fields, message]) => {
        assert.instanceOf(fields.err, Error);
        assert.strictEqual(message, 'label set skipped: not a valid label set file');

        return fields.file;
      });
      assert.sameMembers(logged, ['bad.json', 'noname.json', 'numname.json', 'null.json']);
    });

    it('logs with console by default', async () => {
      const dir = await tmp({ 'bad.json': '{' });
      const warn = sinon.stub(console, 'warn');
      try {
        assert.deepEqual(await listLabelSets(dir), []);
        assert.strictEqual(warn.callCount, 1);
      } finally {
        warn.restore();
      }
    });

    it('answers [] for an empty folder', async () => {
      assert.deepEqual(await listLabelSets(await tmp({})), []);
    });

    it('rejects for a missing folder', async () => {
      const dir = path.join(await tmp({}), 'missing');
      let error;
      try {
        await listLabelSets(dir);
      } catch (err) {
        error = err;
      }
      assert.strictEqual(error && error.code, 'ENOENT');
    });
  });

  describe('labelSetsRoute', () => {
    const fakeRes = () => {
      const res = { headersSent: false };
      res.json = sinon.spy(() => { res.headersSent = true; });
      res.status = sinon.spy(() => res);

      return res;
    };

    it('answers the label sets as JSON, with its options', async () => {
      const dir = await tmp({ 'b.json': set('B'), 'a.json': set('A'), 'bad.json': '{' });
      const logger = fakeLogger();
      const res = fakeRes();
      await labelSetsRoute(dir, { first: 'b.json', logger })({}, res);
      assert.deepEqual(res.json.firstCall.args, [[{ name: 'B', source: 'b.json' }, { name: 'A', source: 'a.json' }]]);
      assert.isFalse(res.status.called);
      assert.strictEqual(logger.warn.callCount, 1);
    });

    it('a missing folder answers 500 {error: \'Server error\'}, logged with req.log', async () => {
      const dir = path.join(await tmp({}), 'missing');
      const req = { log: { error: sinon.spy() } };
      const res = fakeRes();
      await labelSetsRoute(dir)(req, res);
      assert.deepEqual(res.status.firstCall.args, [500]);
      assert.deepEqual(res.json.firstCall.args, [{ error: 'Server error' }]);
      assert.strictEqual(req.log.error.callCount, 1);
    });

    it('throws at creation without a dir, naming it', () => {
      assert.throws(() => labelSetsRoute(), TypeError, /dir/);
      for (const dir of ['', null, 3]) {
        assert.throws(() => labelSetsRoute(dir), TypeError, /dir/);
      }
    });
  });
});
