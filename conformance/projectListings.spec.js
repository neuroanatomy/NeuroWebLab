/**
 * The conformance suite's own test: slice 3 against the reference app
 * (test/conformanceApp.js, the approved rules), then against broken
 * variants of it, each turning one rule off, run in a nested mocha: the
 * suite fails on each, and only on the rules the variant breaks.
 */
const assert = require('assert');
const { ACCESS_RULES, LISTING_RULES, caseRunner } = require('./runner');
const { projectListings } = require('./projectListings');
const { harness } = require('../test/conformanceHarness');

const h = harness('conformance_spec3');

/* Each variant: the option of test/conformanceApp.js, and the rules it breaks (the first must fail) */
const VARIANTS = [
  ['pageBeforeFilter', ['3.2']],
  ['userIDOnly', ['3.3']],
  ['rangeRequired', ['3.4']],
  ['sliceBeforeFilter', ['3.4']],
  ['hiddenCollaboratorsCounted', ['3.5']],
  ['noModified', ['3.5']],
  ['privateInSearch', ['3.6']],
  ['usernameOnly', ['3.7']],
  ['emailInUserSearch', ['3.7']],
  ['regexSearch', ['3.8']],
  ['nonStringAccepted', ['3.8']]
];

describe('conformance: slice 3 on an app that follows the approved rules', function () {
  before(h.start);
  after(h.stop);

  projectListings(h.adapter({}), { prefix: h.prefix });

  describe('the suite fails where the app breaks a rule', function () {
    afterEach(function () {
      Object.keys(h.broken).forEach((key) => { delete h.broken[key]; });
    });

    for (const [option, rules] of VARIANTS) {
      it(`${option}: ${rules[0]} fails, and nothing outside ${rules.join(', ')}`, async function () {
        h.broken[option] = true;
        const { failed } = await h.runNested(projectListings, h.adapter({}));
        const seen = [...new Set(failed.flatMap((f) => f.rules))];
        assert.ok(seen.includes(rules[0]), `${rules[0]} did not fail: ${JSON.stringify(failed)}`);
        const others = failed.filter((f) => f.rules.length === 0 || f.rules.some((r) => !rules.includes(r)));
        assert.deepStrictEqual(others, [], 'other failures');
      });
    }

    it('declared, the variant\'s failures are known differences (pending), and the run passes', async function () {
      h.broken.privateInSearch = true;
      const { failed, pending } = await h.runNested(projectListings, h.adapter({ '3.6': 'test' }));
      assert.deepStrictEqual(failed, []);
      assert.ok(pending.length === 3 && pending.every((t) => (/\[known difference 3\.6/).test(t)), JSON.stringify(pending));
    });

    it('a route the app lacks: its cases are skipped, not passed', async function () {
      const { failed, pending, passes } = await h.runNested(projectListings, { ...h.adapter({ 'route:searchProjects': 'test' }), routes: { searchProjects: null } }, /3\.[68]/);
      assert.deepStrictEqual(failed, []);
      assert.strictEqual(pending.filter((t) => (/not routed in this app/).test(t)).length, 6, JSON.stringify(pending));
      assert.strictEqual(passes, 2, 'the user search cases of 3.8 still run');
    });

    it('a declared difference that no longer differs is reported', async function () {
      const { failed } = await h.runNested(projectListings, h.adapter({ '3.4': 'test' }), /3\.4|still differs/);
      assert.deepStrictEqual(failed.map((f) => f.title), ['every declared difference still differs']);
      assert.match(failed[0].message, /3\.4/);
    });

    it('a rule slices 1 and 3 both check (3.3) is judged by the last slice, on both slices\' cases', async function () {

      /* Two slices' runners on one app adapter; slice 1 passes 3.3, slice 3 fails it or not */
      const run = async (slice3Fails) => {
        const app = { expectedDifferences: { '3.3': 'test' } };
        const resolved = { expectedDifferences: app.expectedDifferences, routes: {} };
        const runners = [caseRunner(resolved, app, ACCESS_RULES), caseRunner(resolved, app, LISTING_RULES)];
        const context = { test: { title: '' }, skip: () => { throw new Error('pending'); } };
        await runners[0].runCase('list', (check) => check('3.3', true, 'listed'))
          .call(context);
        await runners[1].runCase('list', (check) => check('3.3', !slice3Fails, 'not listed'))
          .call(context)
          .catch((e) => assert.strictEqual(e.message, 'pending'));
        const judges = [];
        runners.forEach((r) => r.stillDiffers((title, fn) => judges.push(fn)));

        return judges.map((fn) => {
          try {
            fn();

            return 'ok';
          } catch (e) {
            return e.message.includes('3.3') ? 'gone' : e.message;
          }
        });
      };
      assert.deepStrictEqual(await run(true), ['ok', 'ok'], 'declared and failed in slice 3: still differs');
      assert.deepStrictEqual(await run(false), ['ok', 'gone'], 'passed in both: slice 3 reports it');
    });

    it('a field slice 3 needs and the adapter lacks is named', async function () {
      const { setUserFields, ...without } = h.adapter({});
      assert.strictEqual(typeof setUserFields, 'function');
      const { failed } = await h.runNested(projectListings, without, /3\.7/);
      assert.match(failed[0].message, /adapter\.setUserFields is needed/);
    });
  });
});
