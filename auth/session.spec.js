/* eslint-disable max-statements, max-lines */
/**
 * The whole of NeuroWebLab's init(), as the apps use it: MongoDB session
 * store (connect-mongo on monk's client), passport, local login, /loggedIn.
 */
const { assert } = require('chai');
const express = require('express');
const passport = require('passport');
const nwlIndex = require('../index');
const { listen, close, client } = require('../test/http');
const { makeTmpDirWithFile, removeTmpDir } = require('../test/mocha.test.util');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production');
}

/* stands for GitHub: succeeds at once with a GitHub-like profile */
class FakeGithubStrategy extends passport.Strategy {
  constructor() {
    super();
    this.name = 'github';
  }
  authenticate() {
    this.success({
      username: 'ghuser',
      displayName: 'GH User',
      // eslint-disable-next-line camelcase
      _json: { blog: 'https://example.org', avatar_url: 'https://example.org/a.png' }
    });
  }
}

const githubKeys = { clientID: 'id', clientSecret: 'secret', callbackURL: 'http://127.0.0.1/auth/github/callback' };

const usernameField = 'nickname';
const usersCollection = 'session_spec_users';
const projectsCollection = 'session_spec_projects';
const annotationsCollection = 'session_spec_annotations';

describe('init(): sessions in MongoDB and local login', () => {
  let dir, nwl, server, url;
  const savedLocalSignin = process.env.LOCALSIGNIN;

  const waitForUser = async (name) => {
    for (let i = 0; i < 50; i++) {
      // eslint-disable-next-line no-await-in-loop
      if (await nwl.db.mongoDB().get(usersCollection)
        .findOne({ [usernameField]: name })) { return; }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 20); });
    }
  };

  before(async () => {
    // passport is a singleton: forget the serializers other spec files registered
    passport._serializers = [];
    passport._deserializers = [];
    process.env.LOCALSIGNIN = 'true';
    dir = makeTmpDirWithFile('github-keys.json', JSON.stringify(githubKeys));

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));
    await nwlIndex.init({
      app,
      MONGO_DB: mongoDbPath,
      dirname: dir,
      usernameField,
      usersCollection,
      projectsCollection,
      annotationsCollection
    });
    nwl = { db: app.db };
    passport.use('github', new FakeGithubStrategy());
    // a page that needs a login, as in the apps: remember it, then ask to log in
    app.get('/private', (req, res) => {
      req.session.returnTo = req.originalUrl;
      if (!req.user) {
        return res.status(401).send('log in first');
      }
      res.send('private page for ' + req.user.username);
    });
    app.get('/api/whoami', nwlIndex.authTokenMiddleware, (req, res) => {
      res.json({ user: req.user || null, isTokenAuthenticated: Boolean(req.isTokenAuthenticated) });
    });
    await app.db.mongoDB().get(usersCollection)
      .remove({ [usernameField]: { $ne: 'anyone' } });
    app.get('/', (req, res) => res.send('home'));
    ({ server, url } = await listen(app));
  });

  after(async () => {
    await close(server);
    await nwl.db.nativeMongoDB().collection(usersCollection)
      .deleteMany({});
    await nwl.db.mongoDB().close();
    removeTmpDir(dir);
    if (typeof savedLocalSignin === 'undefined') {
      delete process.env.LOCALSIGNIN;
    } else {
      process.env.LOCALSIGNIN = savedLocalSignin;
    }
  });

  it('signs up, logs in, and the session is stored in MongoDB', async () => {
    const browser = client(url);
    const signup = await browser.post('/localSignup', { json: { username: 'alice', password: 'alicepass1' } });
    assert.strictEqual(signup.status, 200);
    await waitForUser('alice');

    const login = await browser.post('/localLogin', { form: { username: 'alice', password: 'alicepass1' } });
    assert.strictEqual(login.location, '/');
    assert.property(browser.cookies, 'connect.sid');

    const loggedIn = await browser.get('/loggedIn');
    assert.deepEqual(JSON.parse(loggedIn.text), { loggedIn: true, username: 'alice' });

    // the cookie is "s:<sid>.<signature>"
    const [sid] = decodeURIComponent(browser.cookies['connect.sid']).slice(2)
      .split('.');
    const doc = await nwl.db.nativeMongoDB().collection('sessions')
      .findOne({ _id: sid });
    assert.ok(doc, 'session document in the sessions collection');
  });

  const signUpAndLogIn = async (browser, username, password) => {
    await browser.post('/localSignup', { json: { username, password } });
    await waitForUser(username);

    return browser.post('/localLogin', { form: { username, password } });
  };

  it('login changes the session id (passport >= 0.6, against session fixation)', async () => {
    const browser = client(url);
    await browser.get('/private');
    const before = browser.cookies['connect.sid'];
    assert.ok(before, 'a session before login');
    await signUpAndLogIn(browser, 'fixation', 'fixationpass1');
    assert.ok(browser.cookies['connect.sid']);
    assert.notStrictEqual(browser.cookies['connect.sid'], before);
  });

  it('local login comes back to the page that asked for it (returnTo)', async () => {
    const browser = client(url);
    assert.strictEqual((await browser.get('/private?x=1')).status, 401);
    const login = await signUpAndLogIn(browser, 'bob', 'bobpass123');
    assert.strictEqual(login.status, 301);
    assert.strictEqual(login.location, '/private?x=1');
    const page = await browser.get('/private?x=1');
    assert.strictEqual(page.text, 'private page for bob');
  });

  it('local login without a returnTo goes to /', async () => {
    const login = await signUpAndLogIn(client(url), 'carol', 'carolpass1');
    assert.strictEqual(login.location, '/');
  });

  it('a failed local login goes to the login page', async () => {
    const browser = client(url);
    await browser.get('/private');
    const login = await browser.post('/localLogin', { form: { username: 'bob', password: 'wrong' } });
    assert.strictEqual(login.location, '/html/localsignin.html');
    assert.deepEqual(JSON.parse((await browser.get('/loggedIn')).text), { loggedIn: false });
  });

  it('GitHub login comes back to the page that asked for it, and stores the user', async () => {
    const browser = client(url);
    await browser.get('/private?from=github');
    const callback = await browser.get('/auth/github/callback?code=fake');
    assert.strictEqual(callback.status, 302);
    assert.strictEqual(callback.location, '/private?from=github');
    assert.deepEqual(JSON.parse((await browser.get('/loggedIn')).text), { loggedIn: true, username: 'ghuser' });
    const user = await nwl.db.nativeMongoDB().collection(usersCollection)
      .findOne({ [usernameField]: 'ghuser' });
    assert.strictEqual(user.name, 'GH User');
    assert.strictEqual(user.avatarURL, 'https://example.org/a.png');
  });

  it('GitHub login without a returnTo goes to /', async () => {
    const callback = await client(url).get('/auth/github/callback?code=fake');
    assert.strictEqual(callback.location, '/');
  });

  it('logout ends the session (async req.logout) and redirects to /', async () => {
    const browser = client(url);
    await signUpAndLogIn(browser, 'dave', 'davepass12');
    assert.strictEqual((await browser.get('/token')).status, 200);
    const out = await browser.get('/logout');
    assert.strictEqual(out.status, 302);
    assert.strictEqual(out.location, '/');
    assert.deepEqual(JSON.parse((await browser.get('/loggedIn')).text), { loggedIn: false });
    assert.strictEqual((await browser.get('/token')).status, 401);
  });

  it('logout goes back to returnTo when there is one', async () => {
    const browser = client(url);
    await signUpAndLogIn(browser, 'erin', 'erinpass12');
    await browser.get('/private?y=2');
    const out = await browser.get('/logout');
    assert.strictEqual(out.location, '/private?y=2');
  });

  it('logout when not logged in still redirects', async () => {
    const out = await client(url).get('/logout');
    assert.strictEqual(out.status, 302);
    assert.strictEqual(out.location, '/');
  });

  it('a token from /token authenticates, also after logout', async () => {
    const browser = client(url);
    await signUpAndLogIn(browser, 'frank', 'frankpass1');
    const { token } = JSON.parse((await browser.get('/token')).text);
    assert.isString(token);
    await browser.get('/logout');
    const res = await client(url).get(`/api/whoami?token=${token}`);
    assert.deepEqual(JSON.parse(res.text), { user: { username: 'frank' }, isTokenAuthenticated: true });
    const anonymous = await client(url).get('/api/whoami');
    assert.deepEqual(JSON.parse(anonymous.text), { user: null, isTokenAuthenticated: false });
  });

  it('a new client is not logged in', async () => {
    const res = await client(url).get('/loggedIn');
    assert.deepEqual(JSON.parse(res.text), { loggedIn: false });
  });
});
