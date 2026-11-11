/**
 * The conformance suite's own test: slice 1 against a minimal app that
 * follows BrainBox's rules (test/conformanceApp.js), then against broken
 * variants of it, run in a nested mocha, to show the suite fails on it.
 */
const assert = require('assert');
const { accessMatrix } = require('./accessMatrix');
const { harness } = require('../test/conformanceHarness');

// the reads of the four project routes, by every visitor
const READS = /GET \/project\/(json\/)?:p(\/settings|\/files\S*)?( \(a route without token\))?$/;

/* The statuses (1.5, 1.6): each variant answers one old app's code; only `<row>/status` fails */
const STATUS_VARIANTS = [
  ['noView401', '1.5/status', READS],
  ['noView403', '1.5/status', READS],
  ['unknownJSONEmpty', '1.6/status', /unknown project/]
];

const h = harness('conformance_spec');
// the JSON route and the final check are enough to show it
const grep = /GET \/project\/json\/:p$|still differs/;

describe('conformance: slice 1 on an app that follows BrainBox\'s rules', function () {
  before(h.start);
  after(h.stop);

  accessMatrix(h.adapter({}), { prefix: h.prefix });

  describe('the suite fails where the app breaks a rule', function () {
    afterEach(function () {
      Object.keys(h.broken).forEach((key) => { delete h.broken[key]; });
    });

    it('collaborators not hidden: the cases that should hide them fail, and only those', async function () {
      h.broken.collaborators = true;
      const { failed } = await h.runNested(accessMatrix, h.adapter({}), grep);
      assert.ok(failed.length > 0, 'no failure');
      const others = failed.filter((f) => !(/^\[1\.[78]\]/).test(f.message));
      assert.deepStrictEqual(others, [], 'failures other than 1.7 and 1.8');
      assert.ok(failed.length >= 10, `${failed.length} failures`);
    });

    it('declared, the same failures are known differences (pending), and the run passes', async function () {
      h.broken.collaborators = true;
      const { failed, pending } = await h.runNested(accessMatrix, h.adapter({ '1.7': 'test', '1.8': 'test' }), grep);
      assert.deepStrictEqual(failed, []);
      assert.ok(pending.length > 0 && pending.every((t) => (/\[known difference 1\.[78]/).test(t)), 'pending titles name the difference');
    });

    for (const [option, rule, only] of STATUS_VARIANTS) {
      it(`${option}: ${rule} fails, and nothing else`, async function () {
        h.broken[option] = true;
        const { failed, passes } = await h.runNested(accessMatrix, h.adapter({}), only);
        assert.ok(failed.length > 0, 'no failure');
        assert.deepStrictEqual(failed.filter((f) => !f.rules.every((r) => r === rule)), [], `failures other than ${rule}`);
        assert.ok(passes > 0, 'no case passed');
      });
    }

    it('a declared difference that no longer differs is reported', async function () {
      const { failed } = await h.runNested(accessMatrix, h.adapter({ '1.9': 'test' }), grep);
      assert.deepStrictEqual(failed.map((f) => f.title), ['every declared difference still differs']);
      assert.match(failed[0].message, /1\.9/);
    });
  });
});
