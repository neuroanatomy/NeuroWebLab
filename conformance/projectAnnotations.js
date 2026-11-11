/**
 * Slice 4 of the shared project-management suite: annotations by project.
 * `projectAnnotations(adapter)` defines mocha describe/it blocks, as the
 * other slices. The rules are the ones the maintainer approved on 2026-11-11
 * (coordination `tasks/proposed-shared-pm-tests.md`, "Slice 4: rules for the
 * differing rows"); each case is tagged with its row:
 * - 4.1 reading a project's annotations needs `annotations: view`;
 * - 4.2 the member's own row counts if there is one, else `anyone`: a row
 *   lower than `anyone` lowers the member's access;
 * - 4.3 writing needs `annotations: edit`, and a refused write changes
 *   nothing stored;
 * - 4.4 a logged-out visitor never writes, even where `anyone` may edit.
 * Not in the slice: 4.5, 4.6 (per app); 4.7 is slice 2's 2.24.
 *
 * The slice talks to the app through `adapter.annotations.read` and `write`
 * only: the transport (HTTP, WebSocket) is the adapter's.
 */
const crypto = require('crypto');
const { LEVELS, access, rank } = require('./matrix');
const { projectDocument, resolveAdapter } = require('./adapter');
const { ANNOTATION_RULES, caseRunner, checkDeclared } = require('./runner');
const annotationCases = require('./annotationCases');

/* The projects: `anyone` and the members' rows; only the annotations level varies */
const PROJECTS = {
  // nobody but the owner and the members: a member at each level
  private: {
    anyone: access('none', 'none', 'none'),
    rows: Object.fromEntries(LEVELS.map((level) => [`a${level}`, access('view', 'none', level)]))
  },
  // anyone may view the annotations: a member below (none), one above (edit)
  anyoneView: {
    anyone: access('view', 'view', 'view'),
    rows: { below: access('view', 'none', 'none'), above: access('view', 'none', 'edit') }
  },
  // anyone may edit the annotations: members below (none, view)
  anyoneEdit: {
    anyone: access('view', 'view', 'edit'),
    rows: { below: access('view', 'none', 'none'), belowView: access('view', 'none', 'view') }
  }
};
const USER_KEYS = ['owner', 'outsider', ...new Set(Object.values(PROJECTS).flatMap((p) => Object.keys(p.rows)))];

/**
 * A visitor's level on a project's annotations under the approved rules
 * @param {object} project A project of PROJECTS
 * @param {string|null} key The visitor's user key, null when logged out
 * @returns {string} The level
 */
const levelOf = (project, key) => {
  if (key === 'owner') {
    return 'remove';
  }
  // 4.2: the own row if there is one, else `anyone`
  if (key && project.rows[key]) {
    return project.rows[key].annotations;
  }

  return project.anyone.annotations;
};

const mayRead = (project, key) => rank(levelOf(project, key)) >= rank('view');
// 4.4: logged in first
const mayWrite = (project, key) => key !== null && rank(levelOf(project, key)) >= rank('edit');

/**
 * The rule a case belongs to
 * @param {object} project A project of PROJECTS
 * @param {string|null} key The visitor
 * @param {string} op read|write
 * @returns {string} A rule id
 */
const ruleOf = (project, key, op) => {
  const row = key && key !== 'owner' && project.rows[key];
  if (row && rank(row.annotations) < rank(project.anyone.annotations)) {
    return '4.2';
  }
  if (op === 'write' && key === null && rank(project.anyone.annotations) >= rank('edit')) {
    return '4.4';
  }

  return op === 'read' ? '4.1' : '4.3';
};

/**
 * The visitors of a project, in the order the cases run
 * @param {object} project A project of PROJECTS
 * @returns {Array<object>} The visitors: {key, role}, key null when logged out
 */
const visitorsOf = (project) => [
  { key: 'owner', role: 'owner' },
  ...Object.keys(project.rows).map((key) => ({
    key,
    role: rank(project.rows[key].annotations) < rank(project.anyone.annotations) ? 'member below anyone' : 'collaborator'
  })),
  { key: 'outsider', role: 'logged-in non-member' },
  { key: null, role: 'anonymous' }
];

/**
 * Define slice 4's mocha blocks
 * @param {object} appAdapter The app's adapter (adapter.js); the slice uses `annotations.read`, `annotations.write` and `annotations.file`
 * @param {object} [options] `mocha`: the interface (default: the globals); `prefix`: of the users' and projects' names (default: random)
 * @returns {void}
 */
// eslint-disable-next-line max-lines-per-function -- the setup and the cases' helpers share the run's users
const projectAnnotations = (appAdapter, { mocha = global, prefix = `ca${crypto.randomBytes(3).toString('hex')}` } = {}) => {
  const adapter = resolveAdapter(appAdapter);
  checkDeclared(adapter.expectedDifferences);
  const { runCase, stillDiffers } = caseRunner(adapter, appAdapter, ANNOTATION_RULES);
  const { describe, it, before, after } = mocha;
  const users = {};
  const name = (key) => `${prefix}${key}`;
  const seeds = {};
  const stored = [];
  let fileOf = null;
  // the values written: the seeds 1, 2, 3, then one per write case
  let lastValue = 10;
  const userOf = (key) => (key === null ? { username: null, client: adapter.anonymousClient(), token: null } : users[key]);
  const t = {
    describe,
    it,
    runCase,
    PROJECTS,
    levelOf,
    mayRead,
    mayWrite,
    ruleOf,
    visitorsOf,
    seeds,
    name,
    read: (key, projectKey) => adapter.annotations.read(userOf(key), name(projectKey), fileOf(projectKey)),
    write: (key, projectKey, value) => adapter.annotations.write(userOf(key), name(projectKey), fileOf(projectKey), value),
    nextValue: () => {
      lastValue += 1;

      return lastValue;
    }
  };

  describe('conformance slice 4: annotations by project', function () {
    before(async function () {
      // as the other slices: signing up hashes passwords (bcrypt), a budget per user for this setup only
      // eslint-disable-next-line no-invalid-this
      this.timeout(Math.max(this.timeout(), 1000 * USER_KEYS.length));
      const made = await Promise.all(USER_KEYS.map((key) => adapter.createUser(name(key))));
      USER_KEYS.forEach((key, i) => { users[key] = made[i]; });
    });
    before(async function () {
      // each project stored directly, with one file, and an annotation of the owner on it
      const files = {};
      fileOf = (projectKey) => files[projectKey];
      for (const [i, [projectKey, p]] of Object.entries(PROJECTS).entries()) {
        const collaborators = Object.entries(p.rows).map(([key, a]) => ({ username: name(key), access: a }));
        const doc = projectDocument(users.owner, { shortname: name(projectKey), anyone: p.anyone, files: 1, layer: 'Layer', collaborators }, adapter.layer);
        if (adapter.annotations.file) {
          doc.files.list = [{ ...adapter.annotations.file }];
        }
        [files[projectKey]] = doc.files.list;
        stored.push(doc.shortname);
        // eslint-disable-next-line no-await-in-loop
        await adapter.insertProject(doc);
        seeds[projectKey] = i + 1;
        // eslint-disable-next-line no-await-in-loop
        const accepted = await t.write('owner', projectKey, seeds[projectKey]);
        if (accepted !== true) {
          throw new Error(`the owner's annotation on ${doc.shortname} was refused (annotations.write answered ${JSON.stringify(accepted)})`);
        }
      }
    });
    after(async function () {
      await Promise.all(stored.map((shortname) => adapter.removeProject(users.owner, shortname)));
      await Promise.all(Object.values(users).map((u) => adapter.removeUser(u.username)));
    });

    annotationCases(t);

    describe('expected differences', function () {
      stillDiffers(it);
    });
  });
};

module.exports = { projectAnnotations };
