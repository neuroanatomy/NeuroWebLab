const { assert } = require('chai');
const bcrypt = require('bcryptjs');
const { listen, close, client } = require('../test/http');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const local = require('./local');
const SESSION_SECRET = process.env.SESSION_SECRET || 'a mi no me gusta la sémola';

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production ');
}

const app = express();
const db = require('../db/db');
let testServer;
let url;

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */
const usernameField = 'nickname';
const usersCollection = 'user';
const projectsCollection = 'project';

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

describe('Mocha Started', () => {
  it('Mocha works properly', () => {
    assert.strictEqual(1, 1);
  });
});

describe('testing local.js', () => {

  before(async () => {
    await db.init({
      app,
      MONGO_DB: mongoDbPath,
      dirname: __dirname,
      usernameField,
      usersCollection,
      projectsCollection
    });
    app.db = db;

    app.use(session({
      secret: SESSION_SECRET || 'temporary secret',
      resave: false,
      saveUninitialized: false
    }));
    app.use(passport.initialize());
    app.use(passport.session());

    // passport is a singleton: forget the serializers other spec files registered
    passport._serializers = [];
    passport._deserializers = [];
    passport.serializeUser((user, done) => {
      done(null, user);
    });

    passport.deserializeUser((user, done) => {
      done(null, user);
    });

    local({ app, usernameField });
    app.get('/', (req, res) => {
      res.send().status(200);
    });
    ({ server: testServer, url } = await listen(app));
    await db.nativeMongoDB().collection(usersCollection)
      .deleteMany({});
  });

  after(async () => {
    await close(testServer);
    await db.close();
  });

  it('app listening correctly', async () => {
    const res = await client(url).get('/');
    assert.strictEqual(res.status, 200);
  });

  it('inserts local user signup correctly', async () => {
    const res = await client(url).post('/localSignup', {
      json: {
        username: 'bobjane',
        password: 'passinginterest'
      }
    });
    assert.strictEqual(res.status, 200);
  });

  it('using correct username and password authenticates correctly', async () => {
    const res = await client(url).post('/localLogin', {
      form: {
        username: 'bobjane',
        password: 'passinginterest'
      }
    });
    assert.oneOf(res.status, [200, 301, 302]);
    assert.notStrictEqual(res.location, '/html/localsignin.html', 'login failed');
  });

  it('a wrong password is refused', async () => {
    const res = await client(url).post('/localLogin', {
      form: { username: 'bobjane', password: 'wrong' }
    });
    assert.strictEqual(res.location, '/html/localsignin.html');
  });

  describe('hashes written by the native bcrypt still verify (bcryptjs)', () => {
    // written by bcrypt@5.0.1 (native) on Node 26: bcrypt.hash('correct horse battery staple', 10)
    const nativeHash = '$2b$10$RdFTpI9EN2h9iYx3s32NTeeT5rUhsXi0SrIzT25pqZFYEJKlEPrtW';

    it('bcryptjs.compare accepts the native $2b$ hash', async () => {
      assert.strictEqual(await bcrypt.compare('correct horse battery staple', nativeHash), true);
      assert.strictEqual(await bcrypt.compare('wrong', nativeHash), false);
    });

    it('a user stored with a native $2b$ hash logs in', async () => {
      await db.nativeMongoDB().collection(usersCollection)
        .insertOne({ [usernameField]: 'olduser', strategy: 'local', passhash: nativeHash });
      const ok = await client(url).post('/localLogin', {
        form: { username: 'olduser', password: 'correct horse battery staple' }
      });
      assert.strictEqual(ok.location, '/');
      const ko = await client(url).post('/localLogin', {
        form: { username: 'olduser', password: 'wrong' }
      });
      assert.strictEqual(ko.location, '/html/localsignin.html');
    });
  });
});
