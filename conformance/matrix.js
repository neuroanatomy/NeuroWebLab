/**
 * Slice 1: who is in which project, and what BrainBox's rules (the reference)
 * give them. No HTTP here: accessMatrix.js runs the requests.
 *
 * A visitor's level on a list is the highest of: `remove` if they own the
 * project, the `anyone` row, their own row (inventory rows 1.1, 1.2).
 */

const LEVELS = ['none', 'view', 'edit', 'add', 'remove'];
const rank = (level) => Math.max(0, LEVELS.indexOf(level));
const access = (files, collaborators, annotations) => ({ files, collaborators, annotations });
const uniform = (level) => access(level, level, level);

/**
 * @param {object} a Access
 * @returns {string} e.g. "all view" or "files view, collaborators none, annotations view"
 */
const levelsText = (a) => {
  if (a.files === a.collaborators && a.files === a.annotations) {
    return `all ${a.files}`;
  }

  return `files ${a.files}, collaborators ${a.collaborators}, annotations ${a.annotations}`;
};

/* The members of the private project: each level, and the mixes the hiding rules need */
const memberAccess = [
  ...LEVELS.map(uniform),
  access('view', 'none', 'view'),
  access('view', 'view', 'none'),
  access('view', 'none', 'none')
];

/* The `anyone` rows of the public projects */
const anyoneAccess = [
  ...LEVELS.slice(1).map(uniform),
  access('view', 'none', 'none'),
  access('view', 'none', 'view'),
  access('view', 'view', 'none'),
  access('none', 'view', 'view')
];

const NFILES = 2;

/**
 * The projects, by key. `rows`: user key -> access. The secret collaborator
 * is in every project: nobody but those who may view the collaborators should
 * see their name.
 */
const projects = {
  private: { anyone: uniform('none'), rows: { ...Object.fromEntries(memberAccess.map((a, i) => [`m${i}`, a])), secret: uniform('view') } },
  ...Object.fromEntries(anyoneAccess.map((a, i) => [`public${i}`, { anyone: a, rows: { low: uniform('none'), secret: uniform('view') } }])),
  noAnyone: { anyone: null, rows: { m1: uniform('view'), secret: uniform('view') } },
  savedBySecret: { anyone: access('view', 'none', 'none'), rows: { secret: uniform('edit') } }
};

const userKeys = ['owner', 'secret', 'outsider', 'low', ...memberAccess.map((a, i) => `m${i}`)];

/**
 * A visitor's level on a list of a project
 * @param {object} project A project of `projects`
 * @param {string|null} key The visitor's user key, null when logged out
 * @param {string} type files|collaborators|annotations
 * @returns {string} The level
 */
const levelOf = (project, key, type) => {
  if (key === 'owner') {
    return 'remove';
  }
  const anyone = project.anyone ? rank(project.anyone[type]) : 0;
  const own = key && project.rows[key] ? rank(project.rows[key][type]) : 0;

  return LEVELS[Math.max(anyone, own)];
};

const can = (project, key, type, level) => rank(levelOf(project, key, type)) >= rank(level);

/**
 * Whether the visitor's right comes from their own row only (row 1.10: hiding
 * the collaborators must not hide it)
 * @param {object} project A project
 * @param {string|null} key The visitor
 * @param {string} type The list
 * @returns {boolean} Own row grants view, `anyone` does not
 */
const fromOwnRowOnly = (project, key, type) => Boolean(key && key !== 'owner' && project.rows[key]) &&
  rank(project.rows[key][type]) >= 1 && !(project.anyone && rank(project.anyone[type]) >= 1);

/**
 * The visitors of a project for the read cases
 * @param {string} projectKey The project
 * @returns {Array<object>} {key, via: session|token|none, role}
 */
const visitorsOf = (projectKey) => {
  const project = projects[projectKey];
  const members = Object.keys(project.rows).filter((k) => k !== 'secret');
  const roleOf = (k) => (k === 'low' ? 'member below anyone' : 'collaborator');
  const sessions = [
    { key: 'owner', role: 'owner' },
    ...members.map((k) => ({ key: k, role: roleOf(k) })),
    { key: 'outsider', role: 'logged-in non-member' }
  ].map((v) => ({ ...v, via: 'session' }));
  const tokens = [{ key: 'owner', role: 'owner' }, ...members.map((k) => ({ key: k, role: roleOf(k) }))]
    .map((v) => ({ ...v, via: 'token' }));

  return [...sessions, { key: null, role: 'anonymous', via: 'none' }, ...tokens];
};

/**
 * @param {object} project A project
 * @param {object} visitor A visitor
 * @returns {string} The role and the levels, for a test title
 */
const visitorText = (project, visitor) => {
  const own = visitor.key && project.rows[visitor.key] ? ` [own row: ${levelsText(project.rows[visitor.key])}]` : '';
  const anyone = project.anyone ? `anyone: ${levelsText(project.anyone)}` : 'no anyone row';
  const token = visitor.via === 'token' ? ' by token' : '';

  return `${visitor.role}${token}${own} in a project with ${anyone}`;
};

module.exports = {
  LEVELS, NFILES, access, can, fromOwnRowOnly, levelOf, levelsText, projects, rank, uniform, userKeys, visitorText, visitorsOf
};
