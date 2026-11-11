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
 * @property {Annotations} [annotations] Slice 2 (2.24): put an annotation on a file of a project, and tell whether the app still lets it be read
 * @property {function(object): Array<{source: string, name: string}>} [fileList] Slice 2: the files of a project as the JSON route answers it, as {source, name} (default: strings and objects)
 */

/**
 * @typedef {object} Annotations
 * @property {function(User, string, {source: string, name: string}): Promise<void>} add Store an annotation of the project on the file (directly is fine)
 * @property {function(User, string, {source: string, name: string}): Promise<boolean>} readable Whether the user can read it over the app's routes
 */

/** BrainBox's routes (the reference). `:p` project, `:u` user, `:n` number of files, `:page` page. */
const defaultRoutes = {
  page: '/project/:p',
  settings: '/project/:p/settings',
  json: '/project/json/:p',
  files: '/project/json/:p/files?start=0&length=:n',
  save: '/project/json/:p',
  remove: '/project/json/:p',
  list: '/project/json?page=:page',
  userProjects: '/user/json/:u/projects?start=0&length=1000',
  newProject: '/project/new'
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

/* An adapter field slice 2 needs and the app did not give */
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
      readable: missing('annotations.readable', 'whether that annotation can still be read (slice 2: 2.24)')
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

  return { ...defaults, ...adapter, url, routes, expectedDifferences, layer, removesUsers };
};

module.exports = { defaultRoutes, projectDocument, resolveAdapter, signUp };
