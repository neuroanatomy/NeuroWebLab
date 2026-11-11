/**
 * The conformance suite's own test: slice 1 against a minimal app that
 * follows BrainBox's rules (test/conformanceApp.js), then against a broken
 * variant of it, run in a nested mocha, to show the suite fails on it.
 */
const assert = require('assert');
const crypto = require('crypto');
const Mocha = require('mocha');
const passport = require('passport');
const nwlIndex = require('../index');
const { accessMatrix } = require('./accessMatrix');
const { signUp } = require('./adapter');
const { addProjectRoutes, makeApp } = require('../test/conformanceApp');
const { listen, close } = require('../test/http');
const { makeTmpDirWithFile, removeTmpDir } = require('../test/mocha.test.util');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production');
}
const usersCollection = 'conformance_spec_users';

let dir, nwlDb, projects, server, url;
const broken = {};
const prefix = `cfself${crypto.randomBytes(2).toString('hex')}`;
const signedUp = new Map();
const adapter = (expectedDifferences) => ({
  baseURL: () => url,
  // the nested runs reuse the users of the first run (same prefix): bcrypt is slow
  createUser: (username) => {
    if (!signedUp.has(username)) {
      signedUp.set(username, signUp(url, username));
    }

    return signedUp.get(username);
  },
  insertProject: (doc) => { projects.set(doc.shortname, doc); },
  removeProject: (owner, shortname) => { projects.delete(shortname); },
  expectedDifferences
});

/* A silent reporter for the nested runs */
class Silent extends Mocha.reporters.Base {}

/**
 * Run slice 1 in a nested mocha
 * @param {object} theAdapter The adapter
 * @returns {Promise<object>} The failed tests (title, message) and the pending titles
 */
const runNested = (theAdapter) => new Promise((resolve) => {
  // the JSON route and the final check are enough to show it
  const nested = new Mocha({ reporter: Silent, grep: /GET \/project\/json\/:p$|still differs/ });
  const ctx = {};
  nested.suite.emit('pre-require', ctx, null, nested);
  accessMatrix(theAdapter, { mocha: ctx, prefix });
  const failed = [];
  const pending = [];
  const runner = nested.run(() => resolve({ failed, pending, passes: runner.stats.passes }));
  runner.on('fail', (test, err) => failed.push({ title: test.title, message: err.message }));
  runner.on('pending', (test) => pending.push(test.title));
});

describe('conformance: slice 1 on an app that follows BrainBox\'s rules', function () {
  const savedLocalSignin = process.env.LOCALSIGNIN;

  before(async function () {
    passport._serializers = [];
    passport._deserializers = [];
    process.env.LOCALSIGNIN = 'true';
    const app = makeApp();
    // no GitHub login here, but init() reads the keys
    dir = makeTmpDirWithFile('github-keys.json', JSON.stringify({ clientID: 'id', clientSecret: 'secret', callbackURL: 'http://127.0.0.1/cb' }));
    await nwlIndex.init({ app, MONGO_DB: mongoDbPath, dirname: dir, usernameField: 'username', usersCollection, projectsCollection: 'conformance_spec_projects', annotationsCollection: 'conformance_spec_annotations' });
    nwlDb = app.db;
    projects = addProjectRoutes(app, broken);
    ({ server, url } = await listen(app));
  });

  after(async function () {
    await close(server);
    await nwlDb.nativeMongoDB().collection(usersCollection)
      .deleteMany({});
    await nwlDb.close();
    removeTmpDir(dir);
    if (typeof savedLocalSignin === 'undefined') {
      delete process.env.LOCALSIGNIN;
    } else {
      process.env.LOCALSIGNIN = savedLocalSignin;
    }
  });

  accessMatrix(adapter({}), { prefix });

  describe('the suite fails where the app breaks a rule', function () {
    afterEach(function () {
      delete broken.collaborators;
    });

    it('collaborators not hidden: the cases that should hide them fail, and only those', async function () {
      broken.collaborators = true;
      const { failed } = await runNested(adapter({}));
      assert.ok(failed.length > 0, 'no failure');
      const others = failed.filter((f) => !(/^\[1\.[78]\]/).test(f.message));
      assert.deepStrictEqual(others, [], 'failures other than 1.7 and 1.8');
      assert.ok(failed.length >= 10, `${failed.length} failures`);
    });

    it('declared, the same failures are known differences (pending), and the run passes', async function () {
      broken.collaborators = true;
      const { failed, pending } = await runNested(adapter({ '1.7': 'test', '1.8': 'test' }));
      assert.deepStrictEqual(failed, []);
      assert.ok(pending.length > 0 && pending.every((t) => (/\[known difference 1\.[78]/).test(t)), 'pending titles name the difference');
    });

    it('a declared difference that no longer differs is reported', async function () {
      const { failed } = await runNested(adapter({ '1.9': 'test' }));
      assert.deepStrictEqual(failed.map((f) => f.title), ['every declared difference still differs']);
      assert.match(failed[0].message, /1\.9/);
    });
  });
});
