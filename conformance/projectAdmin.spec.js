/**
 * The conformance suite's own test: slice 5 against the reference app
 * (test/conformanceApp.js, its admin routes test/conformanceAdmin.js, the
 * approved rules), then against broken variants of it, each turning one rule
 * off, run in a nested mocha: the suite fails on each, and only on the rules
 * the variant breaks.
 */
const assert = require('assert');
const { projectAdmin } = require('./projectAdmin');
const { harness } = require('../test/conformanceHarness');

const h = harness('conformance_spec5');

/* Each variant: the option of test/conformanceAdmin.js or conformanceApp.js, and the rules it breaks */
const VARIANTS = [
  // a logged-in non-admin passes requireAdmin
  ['nonAdminAllowed', ['5.1', '5.2']],
  // a token does not count as a login
  ['adminTokenRefused', ['5.1']],
  // the page answers 200 logged out, as BrainBox today
  ['pageOpen', ['5.2']],
  ['pageNoPrompt', ['5.2']],
  // the admin change overwrites the current version, no backup
  ['overwriteNoBackup', ['5.4']],
  // a new version, but the previous one stays current too
  ['noBackupMark', ['5.4']],
  // a new version, but the previous one is changed
  ['backupChanged', ['5.4']]
];

describe('conformance: slice 5 on an app that follows the approved rules', function () {
  before(h.start);
  after(h.stop);

  projectAdmin(h.adapter({}), { prefix: h.prefix });

  describe('the suite fails where the app breaks a rule', function () {
    afterEach(function () {
      Object.keys(h.broken).forEach((key) => { delete h.broken[key]; });
    });

    for (const [option, rules] of VARIANTS) {
      it(`${option}: ${rules.join(', ')} fail, and nothing else`, async function () {
        h.broken[option] = true;
        const { failed } = await h.runNested(projectAdmin, h.adapter({}));
        const seen = [...new Set(failed.flatMap((f) => f.rules))].sort();
        assert.deepStrictEqual(seen, [...rules].sort(), JSON.stringify(failed));
        const others = failed.filter((f) => f.rules.length === 0);
        assert.deepStrictEqual(others, [], 'other failures');
      });
    }

    it('declared, the variant\'s failures are known differences (pending), and the run passes', async function () {
      h.broken.pageOpen = true;
      const { failed, pending } = await h.runNested(projectAdmin, h.adapter({ '5.2': 'test' }));
      assert.deepStrictEqual(failed, []);
      assert.ok(pending.length === 1 && (/\[known difference 5\.2/).test(pending[0]), JSON.stringify(pending));
    });

    it('a declared difference that no longer differs is reported', async function () {
      const { failed } = await h.runNested(projectAdmin, h.adapter({ '5.4': 'test' }));
      assert.deepStrictEqual(failed.map((f) => f.title), ['every declared difference still differs']);
      assert.match(failed[0].message, /5\.4/);
    });

    it('the admin fields slice 5 needs and the adapter lacks are named', async function () {
      const adapter = h.adapter({});
      const { user } = adapter.admin;
      const noRoutes = await h.runNested(projectAdmin, { ...adapter, admin: { user } });
      assert.deepStrictEqual(noRoutes.failed.map((f) => f.message.match(/adapter\.admin\.\w+/)[0]), ['adapter.admin.routes', 'adapter.admin.changeProject']);
      const noUser = await h.runNested(projectAdmin, { ...adapter, admin: {} });
      assert.strictEqual(noUser.failed.length, 1, JSON.stringify(noUser.failed));
      assert.match(noUser.failed[0].message, /adapter\.admin\.user is needed/);
    });

    it('the page defaults to /admin, and an adapter may name another one', async function () {
      const adapter = h.adapter({});
      const elsewhere = await h.runNested(projectAdmin, { ...adapter, admin: { ...adapter.admin, page: '/no-admin-here' } }, /5\.2/);
      assert.strictEqual(elsewhere.failed.length, 3, JSON.stringify(elsewhere.failed));
      assert.ok(elsewhere.failed.every((f) => f.rules.includes('5.2')));
    });
  });
});
