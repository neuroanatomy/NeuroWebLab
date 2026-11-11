/**
 * Slice 2 of the shared project-management suite: create, save, delete,
 * validation, versions. `projectLifecycle(adapter)` defines mocha
 * describe/it blocks, as `accessMatrix(adapter)`. The rules are the ones the
 * maintainer approved on 2026-11-11 (coordination
 * `tasks/proposed-shared-pm-tests.md`, "Slice 2: rules for the differing
 * rows"); each case is tagged with its row.
 */
const crypto = require('crypto');
const { parse, rowName, shortnameOf } = require('./checks');
const { access, uniform } = require('./matrix');
const { defaultRoutes, projectDocument, resolveAdapter } = require('./adapter');
const { LIFECYCLE_RULES, caseRunner, checkDeclared } = require('./runner');
const saveCases = require('./lifecycleSave');
const validationCases = require('./lifecycleValidation');
const versionCases = require('./lifecycleVersions');
const deleteCases = require('./lifecycleDelete');

/* The members of every project of the slice (`anyone`: none), and the users who are not */
const ROWS = {
  viewer: uniform('view'),
  editor: uniform('edit'),
  adder: uniform('add'),
  adder2: uniform('add'),
  filesEditor: access('edit', 'view', 'view')
};
const USER_KEYS = ['owner', 'outsider', 'gone', ...Object.keys(ROWS)];
const copy = (doc) => JSON.parse(JSON.stringify(doc));

/**
 * The helpers the cases use (one object, `t`)
 * @param {object} adapter The resolved adapter
 * @param {object} users The users, by key (filled by the setup)
 * @param {string} prefix Of the users' and projects' names
 * @returns {object} The helpers
 */
// eslint-disable-next-line max-lines-per-function -- one closure holds the run's users and projects
const helpers = (adapter, users, prefix) => {
  const tracked = new Set();
  const fill = (route, values) => adapter.routes[route]
    .replace(/:(page|p|u|n)\b/g, (m, k) => encodeURIComponent(values[k]));
  const name = (key) => `${prefix}${key}`;
  const track = (shortname) => {
    tracked.add(shortname);

    return shortname;
  };
  const row = (username, a) => ({ userID: username, username, access: { ...a } });
  const layer = (layerName, more = {}) => ({ display: true, ...adapter.layer, name: layerName, ...more });
  const file = (shortname, tag) => ({ name: `${tag}.nii.gz`, source: `https://example.org/conformance/${shortname}/${tag}.nii.gz` });
  const documentFor = (shortname, { rows = ROWS, anyone = uniform('none'), files = 2, extra = {} } = {}) => {
    const collaborators = Object.entries(rows).map(([k, a]) => ({ username: name(k), access: a }));
    const doc = projectDocument(users.owner, { shortname, anyone, files, layer: 'Layer', collaborators }, adapter.layer);

    return { ...doc, ...extra };
  };
  const post = (user, shortname, body) => (user ? user.client : adapter.anonymousClient())
    .post(fill('save', { p: shortname }), { json: body });
  const save = (user, shortname, data) => post(user, shortname, { data });
  const create = async (key, options) => {
    const shortname = track(name(key));
    const doc = documentFor(shortname, options);
    const res = await save(users.owner, shortname, doc);
    if (res.status !== 200) {
      throw new Error(`creating ${shortname}: ${res.status} ${res.text.slice(0, 200)}`);
    }

    return { shortname, doc };
  };
  // the project as its owner reads it; {} when there is none
  const json = async (shortname) => parse((await users.owner.client.get(fill('json', { p: shortname }))).text) || {};
  const userProjectRows = async () => {
    const body = parse((await users.owner.client.get(fill('userProjects', { u: users.owner.username }))).text);

    return (body && Array.isArray(body.list)) ? body.list : [];
  };
  const listed = async (shortname) => (await userProjectRows()).filter((r) => shortnameOf(r) === shortname).length;

  return {
    adapter,
    users,
    name,
    track,
    tracked,
    copy,
    row,
    layer,
    file,
    document: documentFor,
    post,
    save,
    create,
    json,
    listed,
    remove: (user, shortname) => user.client.delete(fill('remove', { p: shortname })),
    page: (shortname) => users.owner.client.get(fill('page', { p: shortname })),
    settings: (shortname) => users.owner.client.get(fill('settings', { p: shortname })),
    // a project the JSON route answers (1.6: what an unknown project gets differs, it has no owner)
    exists: (project) => Boolean(project && typeof project === 'object' && project.owner),
    rowOf: (project, username) => ((project && project.collaborators && project.collaborators.list) || []).find((c) => rowName(c) === username),
    layerNames: (project) => ((project && project.annotations && project.annotations.list) || []).map((a) => a.name),
    sources: (project) => adapter.fileList(project).map((f) => f.source),
    counts: (project) => ['collaborators', 'files', 'annotations']
      .map((type) => ((project && project[type] && project[type].list) || []).length)
      .join('/'),
    message: (res) => String((parse(res.text) || {}).message || ''),
    // refused under `rule`, and then answered 400 {error} (2.13, the answer to an invalid document)
    invalid: (check, rule, res) => {
      check(rule, res.status !== 200, `refused expected, got ${res.status}`);
      if (res.status !== 200) {
        const body = parse(res.text) || {};
        check('2.13', res.status === 400 && typeof body.error === 'string', `400 {error} expected, got ${res.status} ${res.text.slice(0, 80)}`);
      }
    }
  };
};

/**
 * Define slice 2's mocha blocks
 * @param {object} appAdapter The app's adapter (adapter.js); the slice uses `versions`, `annotations` and `fileList` too
 * @param {object} [options] `mocha`: the interface (default: the globals); `prefix`: of the users' and projects' names (default: random)
 * @returns {void}
 */
const projectLifecycle = (appAdapter, { mocha = global, prefix = `cs${crypto.randomBytes(3).toString('hex')}` } = {}) => {
  const adapter = resolveAdapter(appAdapter);
  checkDeclared(adapter.expectedDifferences);
  const { runCase, stillDiffers } = caseRunner(adapter, appAdapter, LIFECYCLE_RULES);
  const { describe, it, before, after } = mocha;
  const users = {};
  const t = { ...helpers(adapter, users, prefix), describe, it, runCase, R: defaultRoutes, ROWS };

  describe('conformance slice 2: create, save, delete, validation, versions', function () {
    before(async function () {
      // as slice 1: signing up hashes passwords (bcrypt), a budget per user for this setup only
      // eslint-disable-next-line no-invalid-this
      this.timeout(Math.max(this.timeout(), 1000 * USER_KEYS.length));
      const made = await Promise.all(USER_KEYS.map((key) => adapter.createUser(t.name(key))));
      USER_KEYS.forEach((key, i) => { users[key] = made[i]; });
    });
    after(async function () {
      await Promise.all([...t.tracked].map((shortname) => adapter.removeProject(users.owner, shortname)));
      await Promise.all(Object.values(users).map((u) => adapter.removeUser(u.username)));
    });

    saveCases(t);
    validationCases(t);
    versionCases(t);
    deleteCases(t);

    describe('expected differences', function () {
      stillDiffers(it);
    });
  });
};

module.exports = { projectLifecycle };
