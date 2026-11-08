/**
 * The native client's health, and that NeuroWebLab loads no monk, in a
 * separate Node process: what was loaded can only be seen in a fresh module cache.
 */
const { execFile } = require('child_process');
const path = require('path');
const { expect } = require('chai');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production');
}

const script = `
// loads all of NeuroWebLab (auth, session store, helpers)
require('./index');
const db = require('./db/db');
const monkLoaded = () => Object.keys(require.cache).some((f) => f.includes(require('path').sep + 'monk' + require('path').sep));
(async () => {
  const out = {};
  // index.js init() without auth.init(): the session store would still be creating
  // its index when the client is closed below (auth/session.spec.js runs the store)
  await db.init({
    MONGO_DB: process.env.MONGODB_TEST,
    usernameField: 'username',
    usersCollection: 'health_users',
    projectsCollection: 'health_projects',
    annotationsCollection: 'health_annotations'
  });
  out.healthy = db.checkHealth();
  out.monkLoaded = monkLoaded();
  out.mongoDBType = typeof db.mongoDB;
  await db.close();
  out.healthyAfterClose = db.checkHealth();
  console.log('RESULT ' + JSON.stringify(out));
})().catch((e) => { console.log('RESULT ' + JSON.stringify({ error: e.message })); });
`;

describe('db: native client and health', () => {
  let result;

  before((done) => {
    execFile(process.execPath, ['-e', script], {
      cwd: path.join(__dirname, '..'),
      env: process.env
    }, (err, stdout) => {
      if (err) {
        return done(err);
      }
      const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
      result = JSON.parse(line.slice('RESULT '.length));
      done();
    });
  });

  it('init() connects with a MONGO_DB without scheme and is healthy', () => {
    expect(result).not.to.have.property('error');
    expect(mongoDbPath).not.to.match(/^mongodb:/);
    expect(result.healthy).to.equal(true);
  });

  it('requiring NeuroWebLab and init() load no monk', () => {
    expect(result.monkLoaded).to.equal(false);
  });

  it('db.mongoDB is gone in 1.0.0 (an app calling it fails with "not a function")', () => {
    expect(result.mongoDBType).to.equal('undefined');
  });

  it('checkHealth() follows the client: false once closed', () => {
    expect(result.healthyAfterClose).to.equal(false);
  });
});
