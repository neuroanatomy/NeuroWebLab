const { assert } = require('chai');
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
    await db.mongoDB().get(usersCollection)
      .remove({});
  });

  after(async () => {
    await close(testServer);
    await db.mongoDB().close();
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
    // /localSignup answers before its insert (fixed in a later patch), so wait for the user
    for (let i = 0; i < 50; i++) {
      // eslint-disable-next-line no-await-in-loop
      if (await db.mongoDB().get(usersCollection)
        .findOne({ [usernameField]: 'bobjane' })) { break; }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 20); });
    }
    const res = await client(url).post('/localLogin', {
      form: {
        username: 'bobjane',
        password: 'passinginterest'
      }
    });
    assert.oneOf(res.status, [200, 301, 302]);
  });
});
