/**
 * The conformance suite's own test: slice 4 against the reference app
 * (test/conformanceApp.js, the approved rules), then against broken
 * variants of it, each turning one rule off, run in a nested mocha: the
 * suite fails on each, and only on the rules the variant breaks.
 */
const assert = require('assert');
const { projectAnnotations } = require('./projectAnnotations');
const { projectLifecycle } = require('./projectLifecycle');
const { harness } = require('../test/conformanceHarness');

const h = harness('conformance_spec4');

/* Each variant: the option of test/conformanceApp.js, and the rules it breaks (the first must fail) */
const VARIANTS = [
  // the highest of `anyone` and the own row, as microdraw today
  ['maxLevel', ['4.2']],
  // a logged-out visitor writes where `anyone` may edit, as BrainBox today
  ['anonymousWrite', ['4.4']],
  // a refused write answers 403 (401), and stores the value all the same
  ['refusedStillStores', ['4.3', '4.2', '4.4']],
  ['noReadCheck', ['4.1', '4.2']],
  ['viewNeedsEdit', ['4.1', '4.2']],
  ['noWriteCheck', ['4.3', '4.2']],
  ['editNeedsAdd', ['4.3']],
  // a write answers 200, and stores nothing
  ['acceptedNotStored', ['4.3', '4.1', '4.2']]
];

describe('conformance: slice 4 on an app that follows the approved rules', function () {
  before(h.start);
  after(h.stop);

  projectAnnotations(h.adapter({}), { prefix: h.prefix });

  describe('the suite fails where the app breaks a rule', function () {
    afterEach(function () {
      Object.keys(h.broken).forEach((key) => { delete h.broken[key]; });
    });

    for (const [option, rules] of VARIANTS) {
      it(`${option}: ${rules[0]} fails, and nothing outside ${rules.join(', ')}`, async function () {
        h.broken[option] = true;
        const { failed } = await h.runNested(projectAnnotations, h.adapter({}));
        const seen = [...new Set(failed.flatMap((f) => f.rules))];
        assert.ok(seen.includes(rules[0]), `${rules[0]} did not fail: ${JSON.stringify(failed)}`);
        const others = failed.filter((f) => f.rules.length === 0 || f.rules.some((r) => !rules.includes(r)));
        assert.deepStrictEqual(others, [], 'other failures');
      });
    }

    it('declared, the variant\'s failures are known differences (pending), and the run passes', async function () {
      h.broken.anonymousWrite = true;
      const { failed, pending } = await h.runNested(projectAnnotations, h.adapter({ '4.4': 'test' }));
      assert.deepStrictEqual(failed, []);
      assert.ok(pending.length === 1 && (/\[known difference 4\.4/).test(pending[0]), JSON.stringify(pending));
    });

    it('a declared difference that no longer differs is reported', async function () {
      const { failed } = await h.runNested(projectAnnotations, h.adapter({ '4.2': 'test' }));
      assert.deepStrictEqual(failed.map((f) => f.title), ['every declared difference still differs']);
      assert.match(failed[0].message, /4\.2/);
    });

    it('the annotation functions slice 4 needs and the adapter lacks are named', async function () {
      const adapter = h.adapter({});
      const { add, readable } = adapter.annotations;
      const { failed } = await h.runNested(projectAnnotations, { ...adapter, annotations: { add, readable } });
      assert.strictEqual(failed.length, 1, JSON.stringify(failed));
      assert.match(failed[0].message, /adapter\.annotations\.write is needed/);
    });

    it('each slice\'s annotation functions are optional for the other: slice 4 without add/readable, slice 2 without read/write', async function () {
      const adapter = h.adapter({});
      const { add, readable, read, write } = adapter.annotations;
      const four = await h.runNested(projectAnnotations, { ...adapter, annotations: { read, write } });
      assert.deepStrictEqual(four.failed, []);
      assert.ok(four.passes > 30, `slice 4 ran ${four.passes} tests`);
      const two = await h.runNested(projectLifecycle, { ...adapter, annotations: { add, readable } }, /2\.24/);
      assert.deepStrictEqual(two.failed, []);
      assert.strictEqual(two.passes, 1, 'the 2.24 case ran');
    });
  });
});
