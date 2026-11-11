/**
 * The conformance suite's own test: slice 2 against the reference app
 * (test/conformanceApp.js, the approved rules), then against broken
 * variants of it, each turning one rule off, run in a nested mocha: the
 * suite fails on each, and only on the rules the variant breaks.
 */
const assert = require('assert');
const { projectLifecycle } = require('./projectLifecycle');
const { harness } = require('../test/conformanceHarness');

const h = harness('conformance_spec2');

/* Each variant: the option of test/conformanceSave.js or conformanceApp.js, and the rules it breaks (the first must fail) */
const VARIANTS = [
  ['noLogin', ['2.1']],
  ['loggedOut403', ['2.1/status']],
  ['noEditCheck', ['2.2']],
  ['lengthsOnly', ['2.3', '2.20']],
  ['noInPlaceCheck', ['2.4']],
  ['ownerFromClient', ['2.5']],
  ['shortnameFromBody', ['2.6']],
  ['noAnyone', ['2.7']],
  ['accessSubstring', ['2.8']],
  ['usersEveryRow', ['2.9']],
  ['noLayerNames', ['2.10']],
  ['sanitizeJSON', ['2.12']],
  ['invalid500', ['2.13']],
  ['validateStoredRows', ['2.14']],
  ['keepClientFields', ['2.15']],
  ['noBackupMark', ['2.16', '2.15', '2.20']],
  ['dropStoredFields', ['2.17']],
  ['modifiedOnUpdateOnly', ['2.18']],
  ['listBackups', ['2.19', '2.24']],
  ['noRemoveCheck', ['2.22']],
  ['unknownDelete500', ['2.23']],
  ['keepAnnotations', ['2.24']],
  ['inheritDeleted', ['2.25']]
];

describe('conformance: slice 2 on an app that follows the approved rules', function () {
  before(h.start);
  after(h.stop);

  projectLifecycle(h.adapter({}), { prefix: h.prefix });

  describe('the suite fails where the app breaks a rule', function () {
    afterEach(function () {
      Object.keys(h.broken).forEach((key) => { delete h.broken[key]; });
    });

    for (const [option, rules] of VARIANTS) {
      it(`${option}: ${rules[0]} fails, and nothing outside ${rules.join(', ')}`, async function () {
        h.broken[option] = true;
        const { failed } = await h.runNested(projectLifecycle, h.adapter({}));
        const seen = [...new Set(failed.flatMap((f) => f.rules))];
        assert.ok(seen.includes(rules[0]), `${rules[0]} did not fail: ${JSON.stringify(failed)}`);
        const others = failed.filter((f) => f.rules.length === 0 || f.rules.some((r) => !rules.includes(r)));
        assert.deepStrictEqual(others, [], 'other failures');
      });
    }

    it('declared, the variant\'s failures are known differences (pending), and the run passes', async function () {
      h.broken.ownerFromClient = true;
      const { failed, pending } = await h.runNested(projectLifecycle, h.adapter({ '2.5': 'test' }));
      assert.deepStrictEqual(failed, []);
      assert.ok(pending.length === 3 && pending.every((t) => (/\[known difference 2\.5/).test(t)), JSON.stringify(pending));
    });

    it('a declared difference that no longer differs is reported', async function () {
      const { failed } = await h.runNested(projectLifecycle, h.adapter({ '2.23': 'test' }), /2\.23|still differs/);
      assert.deepStrictEqual(failed.map((f) => f.title), ['every declared difference still differs']);
      assert.match(failed[0].message, /2\.23/);
    });

    it('a field slice 2 needs and the adapter lacks is named', async function () {
      const { versions, ...withoutVersions } = h.adapter({});
      assert.strictEqual(typeof versions, 'function');
      const { failed } = await h.runNested(projectLifecycle, withoutVersions, /2\.16/);
      assert.match(failed[0].message, /adapter\.versions is needed/);
    });
  });
});
