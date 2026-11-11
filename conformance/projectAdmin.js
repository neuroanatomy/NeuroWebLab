/**
 * Slice 5 of the shared project-management suite: admin. `projectAdmin(adapter)`
 * defines mocha describe/it blocks, as the other slices. The rules are the ones
 * the maintainer approved on 2026-11-11 (coordination
 * `tasks/proposed-shared-pm-tests.md`, "Slice 5: rules"); each case is tagged
 * with its row:
 * - 5.1 every admin JSON route the adapter lists: logged out 401, a logged-in
 *   non-admin 403, by session and by token; an admin's GETs answer 200
 *   (session and token). POSTs are only checked for refusals: the suite never
 *   sends an admin POST that could change data;
 * - 5.2 the admin page: logged out 401 with the login prompt, a non-admin 403,
 *   an admin 200;
 * - 5.4 an admin change to a project (the adapter's `admin.changeProject`)
 *   stores a new current version and keeps the previous ones as backups.
 * Not in the slice: 5.3, 5.5 (app-specific tools); the log and the lock of
 * 5.4 (per app).
 */
const crypto = require('crypto');
const { uniform } = require('./matrix');
const { projectDocument, resolveAdapter } = require('./adapter');
const { ADMIN_RULES, caseRunner, checkDeclared } = require('./runner');

const METHODS = ['GET', 'POST', 'DELETE'];
// the login prompt of the page shown to logged-out visitors (both apps' askForLogin: "Log in required")
const LOGIN_PROMPT = /log\s?in/i;

/* The visitors of an admin JSON route: [key, via, what the rule wants of a GET, of another method] */
const VISITORS = [
  [null, null, 401, 401],
  ['member', 'session', 403, 403],
  ['member', 'token', 403, 403],
  ['admin', 'session', 200, null],
  ['admin', 'token', 200, null]
];

const visitorText = (key, via) => (key === null ? 'logged out' : `${key === 'admin' ? 'an admin' : 'a logged-in non-admin'} by ${via}`);
const withToken = (path, token) => `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
const what = (res) => `${res.status} ${res.text.slice(0, 120)}`;
const id = (v) => String(v._id);
// a version as stored, but its `backup` mark
const content = (v) => {
  const copy = { ...v };
  delete copy.backup;

  return JSON.stringify(copy);
};

/**
 * The admin routes of the adapter, checked
 * @param {object} admin The resolved `admin` of the adapter
 * @returns {Array<{method: string, path: string}>|null} The routes, null when the adapter has none
 */
const routesOf = (admin) => {
  if (!Array.isArray(admin.routes)) {
    return null;
  }

  return admin.routes.map((r) => {
    const method = String(r && r.method).toUpperCase();
    if (!METHODS.includes(method) || typeof r.path !== 'string') {
      throw new Error(`adapter.admin.routes: ${JSON.stringify(r)} is not {method: GET|POST|DELETE, path}`);
    }

    return { method, path: r.path };
  });
};

/**
 * 5.1: the cases of the admin JSON routes
 * @param {object} t The slice's helpers
 * @returns {void}
 */
const routeCases = (t) => {
  const { describe, it, runCase, admin } = t;
  const routes = routesOf(admin);
  describe('5.1 admin JSON routes: 401 logged out, 403 to non-admins (session and token), 200 to an admin\'s GET', function () {
    if (routes === null) {
      it('the admin JSON routes are listed (5.1)', function () {
        throw new Error('adapter.admin.routes is needed: the app\'s admin JSON routes, [{method, path}] (slice 5: 5.1)');
      });

      return;
    }
    for (const { method, path } of routes) {
      for (const [key, via, getStatus, otherStatus] of VISITORS) {
        const status = method === 'GET' ? getStatus : otherStatus;
        if (status !== null) {
          it(`${method} ${path}, ${visitorText(key, via)}: ${status} (5.1)`, runCase('admin', async (check) => {
            const res = await t.request(key, via, method, path);
            check('5.1', res.status === status, `${status} expected, got ${what(res)}`);
          }));
        }
      }
    }
  });
};

/**
 * 5.2: the admin page
 * @param {object} t The slice's helpers
 * @returns {void}
 */
const pageCases = (t) => {
  const { describe, it, runCase, admin } = t;
  describe('5.2 the admin page: 401 logged out with the login prompt, 403 to non-admins, 200 to an admin', function () {
    it(`GET ${admin.page}, logged out: 401 and the login prompt (5.2)`, runCase('admin', async (check) => {
      const res = await t.request(null, null, 'GET', admin.page);
      check('5.2', res.status === 401, `401 expected, got ${what(res)}`);
      check('5.2', LOGIN_PROMPT.test(res.text), `the login prompt expected, got ${what(res)}`);
    }));
    it(`GET ${admin.page}, a logged-in non-admin: 403 (5.2)`, runCase('admin', async (check) => {
      const res = await t.request('member', 'session', 'GET', admin.page);
      check('5.2', res.status === 403, `403 expected, got ${what(res)}`);
    }));
    it(`GET ${admin.page}, an admin: 200 (5.2)`, runCase('admin', async (check) => {
      const res = await t.request('admin', 'session', 'GET', admin.page);
      check('5.2', res.status === 200, `200 expected, got ${what(res)}`);
    }));
  });
};

/**
 * 5.4: an admin change is a new version, the previous ones kept as backups
 * @param {object} t The slice's helpers
 * @returns {void}
 */
const changeCases = (t) => {
  const { describe, it, runCase, admin, adapter, users } = t;
  describe('5.4 an admin change stores a new current version and keeps the previous ones as backups', function () {
    it('an admin change to a project: one current version, a new one; every earlier version kept, as a backup (5.4)', runCase('admin', async (check) => {
      const shortname = t.track(t.name('changed'));
      const spec = { shortname, anyone: uniform('view'), collaborators: [], files: 2, layer: 'Layer' };
      await adapter.insertProject(projectDocument(users.member, spec, adapter.layer));
      const before = await adapter.versions(shortname);
      await admin.changeProject(users.admin, shortname);
      const after = await adapter.versions(shortname);
      const currents = after.filter((v) => !v.backup);
      check('5.4', currents.length === 1, `one current version expected, got ${currents.length}`);
      check('5.4', currents.length > 0 && currents.every((v) => !before.some((b) => id(b) === id(v))), 'the current version is not a new one');
      for (const b of before) {
        const kept = after.find((v) => id(v) === id(b));
        check('5.4', Boolean(kept) && kept.backup === true && content(kept) === content(b), `version ${id(b)} was not kept unchanged as a backup`);
      }
    }));
  });
};

/**
 * Define slice 5's mocha blocks
 * @param {object} appAdapter The app's adapter (adapter.js); the slice uses `admin` and, for 5.4, `insertProject` and `versions`
 * @param {object} [options] `mocha`: the interface (default: the globals); `prefix`: of the users' and projects' names (default: random)
 * @returns {void}
 */
const projectAdmin = (appAdapter, { mocha = global, prefix = `cd${crypto.randomBytes(3).toString('hex')}` } = {}) => {
  const adapter = resolveAdapter(appAdapter);
  checkDeclared(adapter.expectedDifferences);
  const { runCase, stillDiffers } = caseRunner(adapter, appAdapter, ADMIN_RULES);
  const { describe, it, before, after } = mocha;
  const users = {};
  const stored = [];
  const t = {
    describe,
    it,
    runCase,
    adapter,
    admin: adapter.admin,
    users,
    name: (key) => `${prefix}${key}`,
    track: (shortname) => {
      stored.push(shortname);

      return shortname;
    },
    // a request of a visitor: logged out (key null), or a user by session or token
    request: (key, via, method, path) => {
      const browser = key === null || via === 'token' ? adapter.anonymousClient() : users[key].client;
      const target = via === 'token' ? withToken(path, users[key].token) : path;

      return browser[method.toLowerCase()](target, method === 'GET' ? {} : { json: {} });
    }
  };

  describe('conformance slice 5: admin', function () {
    before(async function () {
      // as the other slices: signing up hashes passwords (bcrypt), a budget per user for this setup only
      // eslint-disable-next-line no-invalid-this
      this.timeout(Math.max(this.timeout(), 2000));
      users.member = await adapter.createUser(t.name('member'));
      users.admin = await adapter.admin.user();
    });
    after(async function () {
      await Promise.all(stored.map((shortname) => adapter.removeProject(users.member, shortname)));
      await Promise.all(Object.values(users).map((u) => adapter.removeUser(u.username)));
    });

    routeCases(t);
    pageCases(t);
    changeCases(t);

    describe('expected differences', function () {
      stillDiffers(it);
    });
  });
};

module.exports = { projectAdmin };
