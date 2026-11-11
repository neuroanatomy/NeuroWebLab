/**
 * The adapter an app gives the conformance suite, and its defaults.
 *
 * The suite runs inside the app's own mocha process, against the server the
 * app's test setup already started. It talks to it over HTTP only.
 */
const { client } = require('./http');

/**
 * @typedef {object} Access
 * @property {string} collaborators none|view|edit|add|remove
 * @property {string} annotations none|view|edit|add|remove
 * @property {string} files none|view|edit|add|remove
 */

/**
 * @typedef {object} User
 * @property {string} username The username
 * @property {object} client A cookie client logged in as the user (conformance/http.js)
 * @property {string} token An API token of the user (GET /token)
 */

/**
 * @typedef {object} ProjectSpec What the suite asks for
 * @property {string} shortname Alphanumeric
 * @property {Access|null} anyone The `anyone` row, or null for no `anyone` row (stored directly)
 * @property {Array<{username: string, access: Access}>} collaborators The other rows
 * @property {number} files How many files
 * @property {string} layer The name of the one annotation layer
 */

/**
 * @typedef {object} Adapter
 * @property {string|function(): string} baseURL The running app's URL (a function if known late)
 * @property {object} [layer] The annotation layer type the app accepts, e.g. {type: 'volume', values: 'foreground.json'}
 * @property {function(string): Promise<User>} [createUser] Default: POST /localSignup, /localLogin, GET /token
 * @property {function(string): Promise<void>} [removeUser] Remove a user made by createUser (default: none)
 * @property {function(): object} [anonymousClient] Default: a cookie client without a session
 * @property {function(User, ProjectSpec): Promise<object>} [createProject] Returns the document stored. Default: POST /project/json/:p with projectDocument()
 * @property {function(object): Promise<void>} [insertProject] Store a document directly (needed for `anyone: null`)
 * @property {function(User, string): Promise<void>} removeProject Remove every version of a project
 * @property {object} [routes] Route templates that differ from BrainBox's; null for a route the app lacks
 * @property {Object<string, string>} [expectedDifferences] Rule id (see README) -> the inventory or ledger row
 * @property {function(string): Promise<Array<object>>} [versions] Slice 2: every stored document of a shortname, current and backups, oldest first
 * @property {Annotations} [annotations] Slice 2 (2.24): put an annotation on a file of a project, and tell whether the app still lets it be read; slice 4: read and write one as a user
 * @property {function(object): Array<{source: string, name: string}>} [fileList] Slice 2: the files of a project as the JSON route answers it, as {source, name} (default: strings and objects)
 * @property {function(string, object): Promise<void>} [setUserFields] Slice 3 (3.7): store fields of a user made by createUser, e.g. {name, email} (directly is fine)
 * @property {Rows} [rows] Slice 3: the rows of a listing or search answer, in the suite's shape (defaults: both apps' shapes)
 * @property {Admin} [admin] Slice 5: the app's admin routes, page and user, and an admin change
 */

/**
 * @typedef {object} Admin
 * @property {Array<{method: string, path: string}>} [routes] 5.1: every admin JSON route (GET, POST or DELETE; the path may carry a query, e.g. `?url=...`); the suite runs no admin POST
 * @property {string} [page] 5.2: the admin page (default `/admin`)
 * @property {function(): Promise<User>} [user] An admin, a User as createUser's (removed by removeUser)
 * @property {function(User, string): Promise<void>} [changeProject] 5.4: as the admin, run one of the app's admin actions on a project the slice stored; it may store versions of its own first
 */

/**
 * @typedef {object} Rows Each takes the parsed answer and returns its rows, or null if it is not a list
 * @property {function(*): Array<{shortname: string}>|null} [list] GET ?page
 * @property {function(*): Array<{shortname: string, numFiles: number, numCollaborators: number, modified: string}>|null} [userProjects] A user's projects
 * @property {function(*): Array<{shortname: string, name: string}>|null} [searchProjects] Project search
 * @property {function(*): Array<{username: string, name: string}>|null} [searchUsers] User search
 */

/**
 * @typedef {object} Annotations
 * @property {function(User, string, {source: string, name: string}): Promise<void>} [add] Slice 2: store an annotation of the project on the file (directly is fine)
 * @property {function(User, string, {source: string, name: string}): Promise<boolean>} [readable] Slice 2: whether the user can read it over the app's routes
 * @property {function(User, string, {source: string, name: string}): Promise<{refused: true}|{value: number|null}>} [read] Slice 4: the value of the user's view of the annotation, over the app's routes or connections; null when none is stored
 * @property {function(User, string, {source: string, name: string}, number): Promise<boolean>} [write] Slice 4: write the annotation's value (an integer 1-255) as the user; true if the app accepted it
 * @property {{source: string, name: string}} [file] Slice 4: the file the slice's projects list and annotate (default: projectDocument's first file)
 */

/**
 * The logged-out visitor, for slice 4's `annotations.read` and `write`: no
 * username, no token, a client without a session
 * @typedef {object} AnonymousUser
 * @property {null} username Null
 * @property {object} client A cookie client without a session
 * @property {null} token Null
 */

/**
 * BrainBox's routes (the reference). `:p` project, `:u` user, `:n` number of
 * files, `:page` page, `:start`/`:length` a range, `:q` a search text.
 * Project search is microdraw's: BrainBox has none (approved 3.6).
 */
const defaultRoutes = {
  page: '/project/:p',
  settings: '/project/:p/settings',
  json: '/project/json/:p',
  files: '/project/json/:p/files?start=0&length=:n',
  save: '/project/json/:p',
  remove: '/project/json/:p',
  list: '/project/json?page=:page',
  userProjects: '/user/json/:u/projects?start=0&length=1000',
  newProject: '/project/new',
  userProjectsAll: '/user/json/:u/projects',
  userProjectsRange: '/user/json/:u/projects?start=:start&length=:length',
  searchProjects: '/search/json/projects?q=:q',
  searchUsers: '/api/userNameQuery?q=:q'
};

/**
 * Sign up, log in and get a token, over NWL's routes (LOCALSIGNIN=true)
 * @param {string} baseURL The app's URL
 * @param {string} username A new username
 * @returns {Promise<User>} The user
 */
const signUp = async (baseURL, username) => {
  const password = `${username}-pw`;
  const browser = client(baseURL);
  const signup = await browser.post('/localSignup', { json: { username, password } });
  if (signup.status !== 200) {
    throw new Error(`/localSignup ${username}: ${signup.status} ${signup.text}`);
  }
  const login = await browser.post('/localLogin', { form: { username, password } });
  if (!browser.cookies['connect.sid'] || login.location === '/html/localsignin.html') {
    throw new Error(`/localLogin ${username}: no session`);
  }
  const res = await browser.get('/token');
  const { token } = JSON.parse(res.text);

  return { username, client: browser, token };
};

/**
 * A project document both apps accept, built from a spec: rows keyed by
 * `userID` and `username`, files `{name, source}` with http(s) sources.
 * @param {User} owner The owner
 * @param {ProjectSpec} spec The spec
 * @param {object} layer The layer's type and values
 * @returns {object} The document
 */
const projectDocument = (owner, spec, layer) => {
  const row = (username, access) => ({ userID: username, username, access: { ...access } });
  const anyone = spec.anyone ? [{ ...row('anyone', spec.anyone), name: 'Any User' }] : [];

  return {
    name: `Conformance ${spec.shortname}`,
    shortname: spec.shortname,
    url: '',
    owner: owner.username,
    collaborators: { list: [...anyone, ...spec.collaborators.map((c) => row(c.username, c.access))] },
    files: {
      list: Array.from({ length: spec.files }, (_, i) => ({
        name: `file${i}.nii.gz`,
        source: `https://example.org/conformance/${spec.shortname}/file${i}.nii.gz`
      }))
    },
    annotations: { list: [{ display: true, ...layer, name: spec.layer }] }
  };
};

/**
 * A file of a project's JSON as {source, name}: BrainBox answers strings, microdraw objects (decision C)
 * @param {string|object} f A file
 * @returns {{source: string, name: string}} The file
 */
const fileOf = (f) => {
  if (typeof f === 'string') {
    return { source: f, name: f.slice(f.lastIndexOf('/') + 1) };
  }

  return { source: f && f.source, name: f && f.name };
};

const arrayOf = (body, row) => (Array.isArray(body) ? body.map(row) : null);
const shortnameOf = (r) => (typeof r === 'string' ? r : (r && (r.project || r.shortname)) || '');

/* Slice 3's rows: BrainBox's and microdraw's shapes */
const defaultRows = {
  list: (body) => arrayOf(body, (r) => ({ shortname: shortnameOf(r) })),
  userProjects: (body) => arrayOf(body && body.list, (r) => ({
    shortname: shortnameOf(r),
    numFiles: r && r.numFiles,
    numCollaborators: r && r.numCollaborators,
    modified: r && r.modified
  })),
  searchProjects: (body) => arrayOf(body, (r) => ({ shortname: shortnameOf(r), name: r && (r.name || r.projectName) })),
  searchUsers: (body) => arrayOf(body, (r) => ({ username: r && (r.username || r.nickname), name: r && r.name }))
};

/* An adapter field a slice needs and the app did not give */
const missing = (field, why) => () => Promise.reject(new Error(`adapter.${field} is needed: ${why}`));

/**
 * The adapter with its defaults filled in
 * @param {Adapter} adapter The app's adapter
 * @returns {Adapter} A complete adapter, with `url()`
 */
const resolveAdapter = (adapter) => {
  const url = () => (typeof adapter.baseURL === 'function' ? adapter.baseURL() : adapter.baseURL);
  const routes = { ...defaultRoutes, ...(adapter.routes || {}) };
  const expectedDifferences = { ...(adapter.expectedDifferences || {}) };
  for (const [name, template] of Object.entries(routes)) {
    if (template === null && !expectedDifferences[`route:${name}`]) {
      throw new Error(`routes.${name} is null: say why in expectedDifferences['route:${name}']`);
    }
  }
  const layer = adapter.layer || { type: 'volume', values: 'foreground.json' };
  const defaults = {
    createUser: (username) => signUp(url(), username),
    removeUser: () => Promise.resolve(),
    versions: missing('versions', 'every stored document of a shortname, oldest first (slice 2: 2.15, 2.16, 2.20)'),
    annotations: {
      add: missing('annotations.add', 'store an annotation of a project on one of its files (slice 2: 2.24)'),
      readable: missing('annotations.readable', 'whether that annotation can still be read (slice 2: 2.24)'),
      read: missing('annotations.read', 'read the value of an annotation of a project on a file as a user (slice 4)'),
      write: missing('annotations.write', 'write the value of an annotation of a project on a file as a user (slice 4)')
    },
    setUserFields: missing('setUserFields', 'store a name and an email for a user (slice 3: 3.7)'),
    admin: {
      routes: null,
      page: '/admin',
      user: missing('admin.user', 'an admin, a User as createUser\'s (slice 5)'),
      changeProject: missing('admin.changeProject', 'run an admin action on a project as the admin (slice 5: 5.4)')
    },
    fileList: (project) => ((project && project.files && Array.isArray(project.files.list)) ? project.files.list : []).map(fileOf),
    anonymousClient: () => client(url()),
    createProject: async (owner, spec) => {
      const doc = projectDocument(owner, spec, layer);
      if (!spec.anyone) {
        await adapter.insertProject(doc);

        return doc;
      }
      const res = await owner.client.post(`/project/json/${spec.shortname}`, { json: { data: doc } });
      if (res.status !== 200) {
        throw new Error(`creating ${spec.shortname}: ${res.status} ${res.text}`);
      }

      return doc;
    }
  };

  // slice 2 removes a user to check 2.9: a no-op removeUser would let it pass without checking
  const removesUsers = typeof adapter.removeUser === 'function';

  const rows = { ...defaultRows, ...(adapter.rows || {}) };

  // each slice's annotation functions are optional: the ones the app gives, the others named when missing
  const annotations = { ...defaults.annotations, ...(adapter.annotations || {}) };
  const admin = { ...defaults.admin, ...(adapter.admin || {}) };

  return { ...defaults, ...adapter, url, routes, expectedDifferences, layer, removesUsers, rows, annotations, admin };
};

module.exports = { defaultRoutes, projectDocument, resolveAdapter, signUp };
