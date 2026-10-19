/* eslint-disable max-statements, max-lines */
/**
 * The whole of NeuroWebLab's init(), as the apps use it: MongoDB session
 * store (connect-mongo on NeuroWebLab's native client), passport, local login, /loggedIn.
 */
const crypto = require('crypto');
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
    await app.db.nativeMongoDB().collection(usersCollection)
      .deleteMany({ [usernameField]: { $ne: 'anyone' } });
    app.get('/', (req, res) => res.send('home'));
    ({ server, url } = await listen(app));
  });

  after(async () => {
    await close(server);
    await nwl.db.nativeMongoDB().collection(usersCollection)
      .deleteMany({});
    await nwl.db.close();
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
    // the documents 0.2.0 wrote (connect-mongo on monk's client): string session, Date expires
    assert.typeOf(doc.session, 'string');
    assert.instanceOf(doc.expires, Date);
    assert.strictEqual(JSON.parse(doc.session).passport.user.username, 'alice');
  });

  const signUpAndLogIn = async (browser, username, password) => {
    await browser.post('/localSignup', { json: { username, password } });

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

  it('GitHub login: no brainboxURL, and `joined` is kept at the next login', async () => {
    await client(url).get('/auth/github/callback?code=fake');
    const first = await nwl.db.nativeMongoDB().collection(usersCollection)
      .findOne({ [usernameField]: 'ghuser' });
    assert.notProperty(first, 'brainboxURL');
    assert.isString(first.joined);
    await new Promise((r) => { setTimeout(r, 5); });
    await client(url).get('/auth/github/callback?code=fake');
    const second = await nwl.db.nativeMongoDB().collection(usersCollection)
      .findOne({ [usernameField]: 'ghuser' });
    assert.strictEqual(second.joined, first.joined);
    const n = await nwl.db.nativeMongoDB().collection(usersCollection)
      .countDocuments({ [usernameField]: 'ghuser' });
    assert.strictEqual(n, 1);
  });

  it('GitHub login: a database error answers 500 without details', async () => {
    const { queryUser } = nwl.db;
    nwl.db.queryUser = () => Promise.reject(new Error('secret internal detail'));
    try {
      const res = await client(url).get('/auth/github/callback?code=fake');
      assert.strictEqual(res.status, 500);
      assert.notInclude(res.text, 'secret internal detail');
    } finally {
      nwl.db.queryUser = queryUser;
    }
  });

  it('queryAllUsers and searchUsers use the configured users collection', async () => {
    const all = await nwl.db.queryAllUsers({ [usernameField]: 'ghuser' });
    assert.lengthOf(all, 1);
    // searchUsers keeps its fields: <usernameField> and name
    const found = await nwl.db.searchUsers({ q: 'ghus' });
    assert.deepEqual(found.map((u) => u[usernameField]), ['ghuser']);
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

  describe('/localSignup (T004 F5)', () => {
    const signup = (body) => client(url).post('/localSignup', { json: body });

    it('answers 200 only once the user is stored: an immediate login works', async () => {
      for (let i = 0; i < 10; i++) {
        const browser = client(url);
        const username = `immediate${i}`;
        // eslint-disable-next-line no-await-in-loop
        assert.strictEqual((await browser.post('/localSignup', { json: { username, password: 'pw' } })).status, 200);
        // eslint-disable-next-line no-await-in-loop
        const login = await browser.post('/localLogin', { form: { username, password: 'pw' } });
        assert.strictEqual(login.location, '/', `login ${i} right after sign-up`);
      }
    });

    it('refuses an existing local username (409) and keeps its password', async () => {
      assert.strictEqual((await signup({ username: 'gina', password: 'first' })).status, 200);
      const again = await signup({ username: 'gina', password: 'second' });
      assert.strictEqual(again.status, 409);
      assert.deepEqual(JSON.parse(again.text), { error: 'username already taken' });
      const n = await nwl.db.nativeMongoDB().collection(usersCollection)
        .countDocuments({ [usernameField]: 'gina' });
      assert.strictEqual(n, 1);
      assert.strictEqual((await client(url).post('/localLogin', { form: { username: 'gina', password: 'first' } })).location, '/');
      assert.strictEqual((await client(url).post('/localLogin', { form: { username: 'gina', password: 'second' } })).location, '/html/localsignin.html');
    });

    it('refuses the name of an existing GitHub user, ignoring case', async () => {
      await nwl.db.nativeMongoDB().collection(usersCollection)
        .insertOne({ [usernameField]: 'OctoCat', name: 'The Octocat', avatarURL: 'https://example.org/o.png' });
      assert.strictEqual((await signup({ username: 'OctoCat', password: 'x' })).status, 409);
      assert.strictEqual((await signup({ username: 'octocat', password: 'x' })).status, 409);
      const n = await nwl.db.nativeMongoDB().collection(usersCollection)
        .countDocuments({ [usernameField]: { $in: ['OctoCat', 'octocat'] } });
      assert.strictEqual(n, 1);
    });

    it('refuses "anyone"', async () => {
      assert.strictEqual((await signup({ username: 'anyone', password: 'x' })).status, 400);
      assert.strictEqual((await signup({ username: 'Anyone', password: 'x' })).status, 400);
    });

    it('refuses invalid input with 400', async () => {
      const bad = [
        {},
        { password: 'x' },
        { username: '', password: 'x' },
        { username: 'x'.repeat(41), password: 'x' },
        { username: 'with space', password: 'x' },
        { username: '-dash', password: 'x' },
        { username: 'a/b', password: 'x' },
        { username: { $ne: null }, password: 'x' },
        { username: ['a'], password: 'x' },
        { username: 'nopassword' },
        { username: 'emptypassword', password: '' },
        { username: 'objpassword', password: { a: 1 } },
        { username: 'longpassword', password: 'é'.repeat(37) }
      ];
      for (const body of bad) {
        // eslint-disable-next-line no-await-in-loop
        const res = await signup(body);
        assert.strictEqual(res.status, 400, JSON.stringify(body));
        assert.isString(JSON.parse(res.text).error);
      }
      const n = await nwl.db.nativeMongoDB().collection(usersCollection)
        .countDocuments({ [usernameField]: { $in: ['nopassword', 'emptypassword', 'objpassword', 'longpassword'] } });
      assert.strictEqual(n, 0);
    });

    it('accepts the names the apps use in their tests', async () => {
      for (const username of ['m5d-auth-user', 'Anonymous', 'a.b_c-d', 'x'.repeat(40), '42']) {
        // eslint-disable-next-line no-await-in-loop
        assert.strictEqual((await signup({ username, password: 'baz' })).status, 200, username);
      }
    });

    it('answers 500 when the user can\'t be stored', async () => {
      const { addUser } = nwl.db;
      nwl.db.addUser = () => Promise.reject(new Error('disk full'));
      try {
        const res = await signup({ username: 'unlucky', password: 'x' });
        assert.strictEqual(res.status, 500);
        assert.deepEqual(JSON.parse(res.text), { error: 'could not create the user' });
      } finally {
        nwl.db.addUser = addUser;
      }
    });

    it('stores a bcrypt hash, never the password', async () => {
      await signup({ username: 'hashed', password: 'plain-secret' });
      const doc = await nwl.db.nativeMongoDB().collection(usersCollection)
        .findOne({ [usernameField]: 'hashed' });
      assert.match(doc.passhash, /^\$2[ab]\$10\$/);
      assert.notInclude(JSON.stringify(doc), 'plain-secret');
      assert.strictEqual(doc.strategy, 'local');
    });
  });

  describe('local login input', () => {
    it('an object as username (JSON body) does not log in', async () => {
      const res = await client(url).post('/localLogin', { json: { username: { $ne: null }, password: 'x' } });
      assert.strictEqual(res.location, '/html/localsignin.html');
    });

    it('a GitHub user (no passhash) cannot log in locally, and it is not an error', async () => {
      const res = await client(url).post('/localLogin', { form: { username: 'OctoCat', password: 'x' } });
      assert.strictEqual(res.location, '/html/localsignin.html');
    });
  });

  describe('what the session keeps of the user (T004 F6)', () => {
    // the session cookie express-session would set for this session id
    const signedCookie = (sid) => {
      const secret = process.env.SESSION_SECRET || 'a mi no me gusta la sémola';
      const signature = crypto.createHmac('sha256', secret).update(sid)
        .digest('base64')
        .replace(/[=]+$/, '');

      return encodeURIComponent(`s:${sid}.${signature}`);
    };

    const sessionDoc = async (browser) => {
      const [sid] = decodeURIComponent(browser.cookies['connect.sid']).slice(2)
        .split('.');
      const doc = await nwl.db.nativeMongoDB().collection('sessions')
        .findOne({ _id: sid });

      return JSON.parse(doc.session);
    };

    it('local login: username, nickname and joined; no passhash', async () => {
      const browser = client(url);
      await browser.post('/localSignup', { json: { username: 'helen', password: 'helenpass' } });
      await browser.post('/localLogin', { form: { username: 'helen', password: 'helenpass' } });
      const stored = (await sessionDoc(browser)).passport.user;
      assert.hasAllKeys(stored, ['username', usernameField, 'joined']);
      assert.strictEqual(stored.username, 'helen');
      assert.strictEqual(stored[usernameField], 'helen');
      const me = JSON.parse((await browser.get('/api/whoami')).text).user;
      assert.deepEqual(me, stored);
      assert.notProperty(me, 'passhash');
    });

    it('GitHub login: username, nickname, name, avatarURL, url; no GitHub profile', async () => {
      const browser = client(url);
      await browser.get('/auth/github/callback?code=fake');
      const stored = (await sessionDoc(browser)).passport.user;
      assert.deepEqual(stored, {
        username: 'ghuser',
        [usernameField]: 'ghuser',
        name: 'GH User',
        avatarURL: 'https://example.org/a.png',
        url: 'https://example.org'
      });
    });

    it('a session stored by an earlier version (whole document) is read in the new shape', async () => {
      const sid = 'old-shape-session-' + Date.now();
      const oldUser = {
        _id: 'abc',
        [usernameField]: 'olduser2',
        username: 'olduser2',
        strategy: 'local',
        passhash: '$2b$10$RdFTpI9EN2h9iYx3s32NTeeT5rUhsXi0SrIzT25pqZFYEJKlEPrtW',
        name: 'Old User',
        _json: { secret: 'github api answer' },
        _raw: '{}'
      };
      await nwl.db.nativeMongoDB().collection('sessions')
        .insertOne({
          _id: sid,
          expires: new Date(Date.now() + 3600e3),
          session: JSON.stringify({
            cookie: { originalMaxAge: null, expires: null, httpOnly: true, path: '/' },
            passport: { user: oldUser }
          })
        });
      const browser = client(url);
      browser.cookies['connect.sid'] = signedCookie(sid);
      const me = JSON.parse((await browser.get('/api/whoami')).text).user;
      assert.deepEqual(me, { username: 'olduser2', [usernameField]: 'olduser2', name: 'Old User' });
      assert.deepEqual(JSON.parse((await browser.get('/loggedIn')).text), { loggedIn: true, username: 'olduser2' });
    });

    it('a stored session user without a username is logged out', async () => {
      const sid = 'broken-session-' + Date.now();
      await nwl.db.nativeMongoDB().collection('sessions')
        .insertOne({
          _id: sid,
          expires: new Date(Date.now() + 3600e3),
          session: JSON.stringify({ cookie: { path: '/' }, passport: { user: { name: 'no username' } } })
        });
      const browser = client(url);
      browser.cookies['connect.sid'] = signedCookie(sid);
      assert.deepEqual(JSON.parse((await browser.get('/loggedIn')).text), { loggedIn: false });
    });
  });

  it('a new client is not logged in', async () => {
    const res = await client(url).get('/loggedIn');
    assert.deepEqual(JSON.parse(res.text), { loggedIn: false });
  });
});
