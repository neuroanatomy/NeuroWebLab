const { assert } = require('chai');
const chai = require('chai');
const chaiHttp = require('chai-http');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const local = require('./local');
const SESSION_SECRET = process.env.SESSION_SECRET || 'a mi no me gusta la sémola';

chai.use(chaiHttp);

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production ');
}

const app = express();
const db = require('../db/db');
let testServer;

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */
const usernameField = 'nickname';
const usersCollection = 'user';
const projectsCollection = 'project';

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const server = 'localhost';
const port = 3002;
const url = `${server}:${port}`;

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
    testServer = app.listen(port, () => console.log(`app listening at port ${port}`));
  });

  after(() => {
    db.mongoDB().close();
    testServer.close();
  });

  it(`app listening at port ${port} correctly`, (done) => {
    chai.request(url)
      .get('/')
      .end((err, res) => {
        console.error(err);
        assert.strictEqual(res.status, 200);
        done();
      });
  });

  it('inserts local user signup correctly', (done) => {
    chai.request(url)
      .post('/localSignup')
      .type('json')
      .send({
        username: 'bobjane',
        password: 'passinginterest'
      })
      .end((err, res) => {
        console.error(err);
        assert.strictEqual(res.status, 200);
        done();
      });
  });

  it('using correct username and password authenticates correctly', (done) => {
    chai.request(url)
      .post('/localLogin')
      .type('form')
      .send({
        username: 'bobjane',
        password: 'passinginterest'
      })
      .redirects(0)
      .end((err, res) => {
        console.error(err);
        assert.oneOf(res.status, [200, 301, 302]);
        done();
      });
  });
});
