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
    dir = makeTmpDirWithFile('no-github-keys.txt', '');

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

  it('a new client is not logged in', async () => {
    const res = await client(url).get('/loggedIn');
    assert.deepEqual(JSON.parse(res.text), { loggedIn: false });
  });
});
