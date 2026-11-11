/**
 * What the conformance suite's own tests share: the reference app
 * (test/conformanceApp.js) started on NeuroWebLab's auth, its adapter, and a
 * nested mocha to run a slice against a broken variant of the app.
 */
const crypto = require('crypto');
const Mocha = require('mocha');
const passport = require('passport');
const nwlIndex = require('../index');
const { signUp } = require('../conformance/adapter');
const { addProjectRoutes, makeApp } = require('./conformanceApp');
const { listen, close } = require('./http');
const { makeTmpDirWithFile, removeTmpDir } = require('./mocha.test.util');

/* A silent reporter for the nested runs */
class Silent extends Mocha.reporters.Base {}

/**
 * A harness: call `start()` in a before hook, `stop()` in an after hook
 * @param {string} name Names the collections, e.g. 'conformance_spec'
 * @returns {object} The harness
 */
// eslint-disable-next-line max-lines-per-function
const harness = (name) => {
  const usersCollection = `${name}_users`;
  const broken = {};
  const signedUp = new Map();
  const savedLocalSignin = process.env.LOCALSIGNIN;
  const h = { broken, prefix: `cfself${crypto.randomBytes(2).toString('hex')}` };
  const users = () => h.db.nativeMongoDB().collection(usersCollection);

  h.start = async () => {
    const mongoDbPath = process.env.MONGODB_TEST;
    if (!mongoDbPath) {
      throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production');
    }
    passport._serializers = [];
    passport._deserializers = [];
    process.env.LOCALSIGNIN = 'true';
    const app = makeApp();
    // no GitHub login here, but init() reads the keys
    h.dir = makeTmpDirWithFile('github-keys.json', JSON.stringify({ clientID: 'id', clientSecret: 'secret', callbackURL: 'http://127.0.0.1/cb' }));
    await nwlIndex.init({ app, MONGO_DB: mongoDbPath, dirname: h.dir, usernameField: 'username', usersCollection, projectsCollection: `${name}_projects`, annotationsCollection: `${name}_annotations` });
    h.db = app.db;
    const userExists = async (username) => Boolean(await users().findOne({ username }));
    const findUsers = (filter, limit) => users().find(filter, { limit })
      .toArray();
    h.store = addProjectRoutes(app, broken, userExists, findUsers);
    ({ server: h.server, url: h.url } = await listen(app));
  };

  h.stop = async () => {
    await close(h.server);
    await users().deleteMany({});
    await h.db.close();
    removeTmpDir(h.dir);
    if (typeof savedLocalSignin === 'undefined') {
      delete process.env.LOCALSIGNIN;
    } else {
      process.env.LOCALSIGNIN = savedLocalSignin;
    }
  };

  h.adapter = (expectedDifferences) => ({
    baseURL: () => h.url,
    // the nested runs reuse the users of the first run (same prefix): bcrypt is slow
    createUser: (username) => {
      if (!signedUp.has(username)) {
        signedUp.set(username, signUp(h.url, username));
      }

      return signedUp.get(username);
    },
    // only the user slice 2 removes on purpose (2.9) is removed: the others serve the nested runs
    removeUser: async (username) => {
      if (username.endsWith('gone')) {
        signedUp.delete(username);
        await users().deleteOne({ username });
      }
    },
    insertProject: (doc) => { h.store.insert(doc); },
    removeProject: (owner, shortname) => { h.store.removeAll(shortname); },
    versions: (shortname) => h.store.versions(shortname),
    setUserFields: async (username, fields) => {
      await users().updateOne({ username }, { $set: fields });
    },
    annotations: {
      add: (owner, project, file) => { h.store.annotations.push({ project, source: file.source }); },
      readable: async (user, project, file) => {
        const res = await user.client.get(`/annotations/json?project=${encodeURIComponent(project)}&source=${encodeURIComponent(file.source)}`);
        const body = res.status === 200 ? JSON.parse(res.text) : [];

        return body.length > 0;
      },
      // slice 4: the value of the current annotation, over the app's routes
      read: async (user, project, file) => {
        const res = await user.client.get(`/annotations/json?project=${encodeURIComponent(project)}&source=${encodeURIComponent(file.source)}`);
        if (res.status !== 200) {
          return { refused: true };
        }
        const values = JSON.parse(res.text).filter((a) => typeof a.value === 'number');

        return { value: values.length > 0 ? values[values.length - 1].value : null };
      },
      write: async (user, project, file, value) => {
        const res = await user.client.post('/annotations/json', { json: { project, source: file.source, value } });

        return res.status === 200;
      }
    },
    expectedDifferences
  });

  /**
   * Run a slice in a nested mocha
   * @param {function} slice accessMatrix, projectLifecycle, projectListings or projectAnnotations
   * @param {object} theAdapter The adapter
   * @param {RegExp} [grep] The tests to run
   * @returns {Promise<object>} The failed tests (title, message, rules) and the pending titles
   */
  h.runNested = (slice, theAdapter, grep) => new Promise((resolve) => {
    const nested = new Mocha({ reporter: Silent, ...(grep ? { grep } : {}) });
    const ctx = {};
    nested.suite.emit('pre-require', ctx, null, nested);
    slice(theAdapter, { mocha: ctx, prefix: h.prefix });
    const failed = [];
    const pending = [];
    const runner = nested.run(() => resolve({ failed, pending, passes: runner.stats.passes }));
    runner.on('fail', (test, err) => failed.push({
      title: test.title,
      message: err.message,
      rules: [...err.message.matchAll(/\[(\d\.\d+(?:\/status)?)\]/g)].map((m) => m[1])
    }));
    runner.on('pending', (test) => pending.push(test.title));
  });

  return h;
};

module.exports = { harness };
