/**
 * Slice 3 of the shared project-management suite: listings and search.
 * `projectListings(adapter)` defines mocha describe/it blocks, as the other
 * slices. The rules are the ones the maintainer approved on 2026-11-11
 * (coordination `tasks/proposed-shared-pm-tests.md`, "Slice 3: rules for the
 * differing rows"); each case is tagged with its row. Not in the slice: 3.9
 * and 3.10 (app-specific).
 */
const crypto = require('crypto');
const { parse } = require('./checks');
const { access, uniform } = require('./matrix');
const { defaultRoutes, projectDocument, resolveAdapter } = require('./adapter');
const { LISTING_RULES, caseRunner, checkDeclared } = require('./runner');
const pageCases = require('./listingsPages');
const userProjectCases = require('./listingsUserProjects');
const searchCases = require('./listingsSearch');

/* 11 users: more than a search may answer (3.7: at most 10) */
const USER_KEYS = ['owner', 'member', 'outsider', 'pager', 'pad0', 'pad1', 'pad2', 'pad3', 'pad4', 'pad5', 'pad6'];
const PUBLIC = uniform('view');
const PRIVATE = uniform('none');

/**
 * The projects of the slice, in the order they are stored: the hidden ones
 * mixed in, so that a listing that pages (or slices) before filtering shows
 * @returns {Array<object>} {key, owner, anyone, rows: {userKey: access}, files, byHTTP, keep: 'userID'|'username'}
 */
// eslint-disable-next-line max-statements -- the plan, in the order it is stored
const projectPlan = () => {
  const plan = [];
  const add = (key, more) => plan.push({ key, owner: 'owner', anyone: PUBLIC, rows: {}, files: 1, ...more });
  // GET ?page (3.1, 3.2): 25 public, 8 the member may view, 8 nobody but the owner may view
  for (let i = 0; i < 25; i += 1) {
    add(`pub${i}`);
    if (i < 8) {
      add(`priv${i}`, { anyone: PRIVATE, rows: { member: uniform('view') } });
      add(`hid${i}`, { anyone: PRIVATE });
    }
  }
  // a user's projects (3.3): owned, a row by userID only, a row by username only
  add('mown', { owner: 'member' });
  add('uid', { rows: { member: uniform('view') }, keep: 'userID' });
  add('uname', { rows: { member: uniform('view') }, keep: 'username' });
  // paging a user's projects (3.4): the even ones public
  for (let i = 0; i < 7; i += 1) {
    add(`pg${i}`, { owner: 'pager', anyone: i % 2 === 0 ? PUBLIC : PRIVATE });
  }
  // rows (3.5): saved over HTTP, the collaborators hidden from anonymous
  add('rows', { anyone: access('view', 'none', 'view'), rows: { member: uniform('view'), pad0: uniform('view') }, files: 3, byHTTP: true });
  // project search (3.6): the private ones first, then 12 public
  for (let i = 0; i < 4; i += 1) {
    add(`srchp${i}`, { anyone: PRIVATE, rows: { member: uniform('view') } });
  }
  for (let i = 0; i < 12; i += 1) {
    add(`srch${i}`);
  }

  return plan;
};

/**
 * The helpers the cases use (one object, `t`)
 * @param {object} adapter The resolved adapter
 * @param {string} prefix Of the users' and projects' names
 * @returns {object} The helpers
 */
// eslint-disable-next-line max-lines-per-function -- one closure holds the run's users and projects
const helpers = (adapter, prefix) => {
  const users = {};
  const name = (key) => `${prefix}${key}`;
  const fill = (route, values) => adapter.routes[route]
    .replace(/:([a-z]+)\b/g, (m, k) => (k in values ? encodeURIComponent(values[k]) : m));
  const visitorPath = (visitor, path) => (visitor.via === 'token'
    ? `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(users[visitor.key].token)}`
    : path);
  const get = async (visitor, path) => {
    const browser = visitor.via === 'session' ? users[visitor.key].client : adapter.anonymousClient();
    const res = await browser.get(visitorPath(visitor, path));

    return { res, body: parse(res.text) };
  };
  const what = (res) => `${res.status} ${res.text.slice(0, 120)}`;

  return {
    adapter,
    users,
    name,
    fill,
    get,
    what,
    // the route with its search text replaced by `query(name)`, e.g. `q=a&q=b`; null if it has no `name=:q`
    rawQuery: (route, query) => {
      const template = adapter.routes[route];
      const m = template.match(/([\w$]+)=:q\b/);

      return m ? template.replace(m[0], query(m[1])) : null;
    },
    // a user's projects, as the visitor sees them (`route`: one of the userProjects routes)
    userProjects: async (visitor, userKey, route = 'userProjects', range = {}) => {
      const { res, body } = await get(visitor, fill(route, { u: name(userKey), ...range }));

      return { res, rows: adapter.rows.userProjects(body) };
    },
    names: (rows) => (rows || []).map((r) => r.shortname),
    ours: (shortnames) => shortnames.filter((s) => s.startsWith(prefix))
  };
};

/**
 * The spec of a planned project (adapter.js ProjectSpec)
 * @param {object} t The helpers
 * @param {object} p A project of projectPlan()
 * @returns {object} The spec
 */
const specOf = (t, p) => ({
  shortname: t.name(p.key),
  anyone: p.anyone,
  files: p.files,
  layer: 'Layer',
  collaborators: Object.entries(p.rows).map(([key, a]) => ({ username: t.name(key), access: a }))
});

/**
 * The document of a planned project, stored directly
 * @param {object} t The helpers
 * @param {object} p A project of projectPlan()
 * @returns {object} The document
 */
const documentOf = (t, p) => {
  const doc = projectDocument(t.users[p.owner], specOf(t, p), t.adapter.layer);
  if (p.keep) {
    // the member's row names them by one key only (3.3)
    const drop = p.keep === 'userID' ? 'username' : 'userID';
    doc.collaborators.list.filter((c) => c.userID !== 'anyone').forEach((c) => { delete c[drop]; });
  }

  return doc;
};

/**
 * Define slice 3's mocha blocks
 * @param {object} appAdapter The app's adapter (adapter.js); the slice uses `setUserFields` and `rows` too
 * @param {object} [options] `mocha`: the interface (default: the globals); `prefix`: of the users' and projects' names (default: random)
 * @returns {void}
 */
const projectListings = (appAdapter, { mocha = global, prefix = `cl${crypto.randomBytes(3).toString('hex')}` } = {}) => {
  const adapter = resolveAdapter(appAdapter);
  checkDeclared(adapter.expectedDifferences);
  const { runCase, stillDiffers } = caseRunner(adapter, appAdapter, LISTING_RULES);
  const { describe, it, before, after } = mocha;
  const plan = projectPlan();
  const t = { ...helpers(adapter, prefix), describe, it, before, runCase, R: defaultRoutes, plan, prefix };
  const stored = [];

  describe('conformance slice 3: listings and search', function () {
    before(async function () {
      // as slices 1 and 2: signing up hashes passwords (bcrypt), a budget per user for this setup only
      // eslint-disable-next-line no-invalid-this
      this.timeout(Math.max(this.timeout(), 1000 * USER_KEYS.length));
      const made = await Promise.all(USER_KEYS.map((key) => adapter.createUser(t.name(key))));
      USER_KEYS.forEach((key, i) => { t.users[key] = made[i]; });
    });
    before(async function () {
      // one at a time: the order they are stored in is the order of the listings
      for (const p of plan) {
        stored.push(t.name(p.key));
        if (p.byHTTP) {
          t.savedAt = Date.now();
          // eslint-disable-next-line no-await-in-loop
          await adapter.createProject(t.users[p.owner], specOf(t, p));
        } else {
          // eslint-disable-next-line no-await-in-loop
          await adapter.insertProject(documentOf(t, p));
        }
      }
    });
    after(async function () {
      await Promise.all(stored.map((shortname) => adapter.removeProject(t.users.owner, shortname)));
      await Promise.all(Object.values(t.users).map((u) => adapter.removeUser(u.username)));
    });

    pageCases(t);
    userProjectCases(t);
    searchCases(t);

    describe('expected differences', function () {
      stillDiffers(it);
    });
  });
};

module.exports = { projectListings };
