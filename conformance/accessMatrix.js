/**
 * Slice 1 of the shared project-management suite: the access matrix.
 * `accessMatrix(adapter)` defines mocha describe/it blocks; call it from a
 * test file of the app, which mocha loads after the app's setup.
 */
const crypto = require('crypto');
const assert = require('assert');
const C = require('./checks');
const { ACCESS_RULES, RULES, caseRunner, checkDeclared } = require('./runner');
const M = require('./matrix');
const { defaultRoutes, resolveAdapter } = require('./adapter');
const specialCases = require('./specialCases');

const READ_ROUTES = [
  { name: 'page', method: 'GET', token: false, base: '1.5', check: C.page },
  { name: 'settings', method: 'GET', token: false, base: '1.5', check: C.page },
  { name: 'json', method: 'GET', token: true, base: '1.5', check: C.json },
  { name: 'files', method: 'GET', token: true, base: '1.5', check: C.files },
  { name: 'list', method: 'GET', token: true, base: '3.1' },
  { name: 'userProjects', method: 'GET', token: false, base: '3.3' }
];
const READ_PROJECTS = ['private', ...Object.keys(M.projects).filter((k) => k.startsWith('public')), 'noAnyone'];
const WRITE_PROJECTS = READ_PROJECTS.filter((k) => k !== 'noAnyone');

/* Visitors of the public and no-anyone projects: the owner and their tokens are tested in the private one */
const visitorsFor = (projectKey) => M.visitorsOf(projectKey)
  .filter((v) => projectKey === 'private' || v.key !== 'owner');

/**
 * Define slice 1's mocha blocks
 * @param {object} appAdapter The app's adapter (adapter.js)
 * @param {object} [options] `mocha`: the interface (default: the globals); `prefix`: of the users' and projects' names (default: random)
 * @returns {void}
 */
// eslint-disable-next-line max-statements -- one closure holds the run's users, projects and tally
const accessMatrix = (appAdapter, { mocha = global, prefix = `cf${crypto.randomBytes(3).toString('hex')}` } = {}) => {
  const adapter = resolveAdapter(appAdapter);
  checkDeclared(adapter.expectedDifferences);
  const { runCase, stillDiffers } = caseRunner(adapter, appAdapter, ACCESS_RULES);
  const { describe, it, before, after } = mocha;
  const names = {
    user: (key) => `${prefix}${key}`,
    project: (key) => `${prefix}${key}`,
    secret: `${prefix}secret`,
    layer: `${prefix}layer`,
    rows: (projectKey) => Object.keys(M.projects[projectKey].rows).length + (M.projects[projectKey].anyone ? 1 : 0)
  };
  const users = {};
  const docs = {};
  const created = new Set();

  const spec = (projectKey, shortname) => {
    const p = M.projects[projectKey];

    return {
      shortname,
      anyone: p.anyone,
      files: M.NFILES,
      layer: names.layer,
      collaborators: Object.entries(p.rows).map(([key, a]) => ({ username: names.user(key), access: a }))
    };
  };
  const create = async (projectKey, shortname) => {
    docs[shortname] = await adapter.createProject(users.owner, spec(projectKey, shortname));
    created.add(shortname);
  };

  const fill = (route, values) => adapter.routes[route]
    .replace(/:(page|p|u|n)\b/g, (m, k) => encodeURIComponent(values[k]));
  const withToken = (path, token) => `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  const request = (visitor, route, method, path, opts) => {
    if (visitor.via === 'session') {
      return users[visitor.key].client[method.toLowerCase()](path, opts);
    }
    const anon = adapter.anonymousClient();
    const p = visitor.via === 'token' && route.token ? withToken(path, visitor.token || users[visitor.key].token) : path;

    return anon[method.toLowerCase()](p, opts);
  };

  const listedIn = async (visitor, route, values, shortname, pageNo = 0) => {
    const res = await request(visitor, route, 'GET', fill(route.name, { ...values, page: pageNo }));
    const body = C.parse(res.text);
    const rows = route.name === 'list' ? body : body && body.list;
    if (!Array.isArray(rows) || rows.length === 0 || route.name !== 'list' || pageNo >= 50) {
      return Array.isArray(rows) && rows.map(C.shortnameOf).includes(shortname);
    }

    return rows.map(C.shortnameOf).includes(shortname) || listedIn(visitor, route, values, shortname, pageNo + 1);
  };

  const readCase = (projectKey, visitor, route) => runCase(route.name, async (check) => {
    const shortname = names.project(projectKey);
    const who = visitor.via === 'token' && !route.token ? null : visitor.key;
    const c = { projectKey, visitor, who, base: route.base };
    const values = { p: shortname, u: users.owner.username, n: M.NFILES };
    if (route.check) {
      const res = await request(visitor, route, 'GET', fill(route.name, values));
      route.check(c, res, check, names);
    } else {
      C.listed(c, await listedIn(visitor, route, values, shortname), check);
    }
  });

  const title = (projectKey, visitor, what) => `${M.visitorText(M.projects[projectKey], visitor)}: ${what}`;

  describe('conformance slice 1: access matrix', function () {
    before(async function () {
      // signing up and logging in hash passwords (bcrypt, slow on purpose): a budget per user,
      // for this setup only; the tests keep the app's timeout
      // eslint-disable-next-line no-invalid-this
      this.timeout(Math.max(this.timeout(), 1000 * M.userKeys.length));
      const made = await Promise.all(M.userKeys.map((key) => adapter.createUser(names.user(key))));
      M.userKeys.forEach((key, i) => { users[key] = made[i]; });
    });
    before(async function () {
      await Promise.all(Object.keys(M.projects).map((key) => create(key, names.project(key))));
      const saved = await users.secret.client.post(`/project/json/${names.project('savedBySecret')}`, { json: { data: docs[names.project('savedBySecret')] } });
      assert.strictEqual(saved.status, 200, `save by the secret collaborator: ${saved.text}`);
    });
    after(async function () {
      await Promise.all([...created].map((shortname) => adapter.removeProject(users.owner, shortname)));
      await Promise.all(Object.values(users).map((u) => adapter.removeUser(u.username)));
    });

    describe('reads', function () {
      for (const projectKey of READ_PROJECTS) {
        for (const visitor of visitorsFor(projectKey)) {
          for (const route of READ_ROUTES) {
            it(title(projectKey, visitor, `${route.method} ${defaultRoutes[route.name]}${route.token ? '' : ' (a route without token)'}`), readCase(projectKey, visitor, route));
          }
        }
      }
    });

    specialCases({ describe, it, C, names, users, runCase, request, fill });

    describe('writes', function () {
      for (const projectKey of WRITE_PROJECTS) {
        for (const visitor of visitorsFor(projectKey)) {
          const route = { token: true };
          it(title(projectKey, visitor, `POST ${defaultRoutes.save}, the stored document unchanged`), runCase('save', async (check) => {
            const shortname = names.project(projectKey);
            const res = await request(visitor, route, 'POST', fill('save', { p: shortname }), { json: { data: docs[shortname] } });
            C.save({ projectKey, who: visitor.key }, res, check);
          }));
          it(title(projectKey, visitor, `DELETE ${defaultRoutes.remove}`), runCase('remove', async (check) => {
            let shortname = names.project(projectKey);
            const allowed = visitor.key && M.can(M.projects[projectKey], visitor.key, 'files', 'remove');
            if (allowed) {
              shortname = `${shortname}del${visitor.key}${visitor.via}`;
              await create(projectKey, shortname);
            }
            const res = await request(visitor, route, 'DELETE', fill('remove', { p: shortname }));
            C.remove({ projectKey, who: visitor.key }, res, check);
            if (allowed && res.status === 200) {
              const gone = await users.owner.client.get(fill('page', { p: shortname }));
              check('2.22', gone.status === 404, `deleted project page: 404 expected, got ${gone.status}`);
            }
          }));
        }
      }
    });

    describe('expected differences', function () {
      stillDiffers(it);
    });
  });
};

module.exports = { accessMatrix, RULES };
