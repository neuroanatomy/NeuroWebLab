const mock = require('mock-fs');
const fs = require('fs');
const path = require('path');

const assert = require('assert');
const chai = require('chai');
const express = require('express');
const monk = require('monk');

const { expect } = chai;

describe('Mocha Started', () => {
  it('Mocha works properly', () => {
    assert.strictEqual(1, 1);
  });
});

const testTxt = 'test_javalin';
const githubKeys = { 'clientID': 'testclientID', 'clientSecret': 'testclientsecret', 'callbackURL': 'testcallbackurl' };

const { getMockfsConfig } = require('../test/mocha.test.util');

describe('mock-fs works properly', () => {
  before(() => {
    const config = {
      ...getMockfsConfig(__dirname, 'test.txt', testTxt),
      ...getMockfsConfig(__dirname, 'github-keys.json', JSON.stringify(githubKeys))
    };
    mock(config);
  });

  after(() => {
    mock.restore();
  });

  it('fetches mocked test.txt properly', async () => {
    const data = await fs.promises.readFile(path.join(__dirname, 'test.txt'), 'utf-8');
    expect(data).to.be.equals(testTxt);
  });

  it('should throw err when fetching non existent file', async () => {
    try {
      await fs.promises.readFile(path.join(__dirname, 'not_exist_txt'), 'utf-8');
      expect(true, 'promise should fail').eq(false);
    } catch (err) {
      expect(err.code).to.be.equal('ENOENT');
    }
  });

  it('mock-fs fetches github-keys.json', async () => {
    const data = await fs.promises.readFile(path.join(__dirname, 'github-keys.json'), 'utf-8');
    expect(data).to.be.equal(JSON.stringify(githubKeys));
  });
});

const containGithubLoginMethod = (loginMethods) => loginMethods.findIndex((loginMethod) => (/github/i).test(loginMethod.url)) >= 0;
const containLocalLoginMethod = (loginMethods) => loginMethods.findIndex((loginMethod) => (/local/i).test(loginMethod.url)) >= 0;

/* must declare auth before mock-fs, or else require will fail */
const auth = require('./auth');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) { throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production'); }
let db, monkDb;

describe('auth.js', () => {

  before((done) => {
    monkDb = monk(mongoDbPath);
    monkDb.then(() => {
      db = {
        mongoDB () {
          return monkDb;
        }
      };
      done();
    });
  });

  after(() => {
    db.mongoDB().close();
  });

  afterEach(() => {
    mock.restore();
  });

  describe('github signin strategy works', () => {
    it('without github-keys.json, app.loginMethods will not be populated with github methods', () => {
      const app = express();
      // mock({});
      auth.init({ app, db, dirname: './', usernameField: 'nickname' });
      const loginMethods = app.get('loginMethods');
      expect(containGithubLoginMethod(loginMethods)).to.be.equal(false);
    });

    it('with mal-formed github-key.json, app.loginMethods will not be populated with github methods', () => {
      mock(getMockfsConfig(__dirname, 'github-keys.json', testTxt));
      const app = express();
      auth.init({ app, db, dirname: __dirname, usernameField: 'nickname' });
      const loginMethods = app.get('loginMethods');
      expect(containGithubLoginMethod(loginMethods)).to.be.equal(false);
    });

    it('with valid github-keys.json, app.loginMethods will be populated with github methods', () => {
      mock(getMockfsConfig(__dirname, 'github-keys.json', JSON.stringify(githubKeys)));
      const app = express();
      auth.init({ app, db, dirname: __dirname, usernameField: 'nickname' });
      const loginMethods = app.get('loginMethods');
      expect(containGithubLoginMethod(loginMethods)).to.be.equal(true);
    });
  });

  describe('local signin strategy works', () => {

    beforeEach(() => {
      mock(getMockfsConfig(__dirname, 'github-keys.json', JSON.stringify(githubKeys)));
    });

    it('when LOCALSIGNIN=undefined, local signin does not exist', () => {
      const app = express();
      auth.init({ app, db, dirname: __dirname, usernameField: 'nickname' });
      const loginMethods = app.get('loginMethods');
      expect(containLocalLoginMethod(loginMethods)).to.be.equal(false);
    });

    it('when LOCALSIGNIN=false, local signin does not exist', () => {
      process.env.LOCALSIGNIN = false;
      const app = express();
      auth.init({ app, db, dirname: __dirname, usernameField: 'nickname' });
      const loginMethods = app.get('loginMethods');
      expect(containLocalLoginMethod(loginMethods)).to.be.equal(false);
    });

    it('when LOCALSIGNIN=true, local signin exists', () => {
      process.env.LOCALSIGNIN = true;
      const app = express();
      auth.init({ app, db, dirname: __dirname, usernameField: 'nickname' });
      const loginMethods = app.get('loginMethods');
      expect(containLocalLoginMethod(loginMethods)).to.be.equal(true);
    });

  });
});
