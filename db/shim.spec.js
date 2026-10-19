/**
 * The deprecated mongoDB() shim and the client's health, in a separate Node
 * process: whether monk was loaded can only be seen in a fresh module cache.
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
  const out = { warnings: [] };
  process.on('warning', (w) => out.warnings.push(w.name + ':' + w.code));
  // index.js init() without auth.init(): the session store would still be creating
  // its index when the client is closed below (auth/session.spec.js runs the store)
  await db.init({
    MONGO_DB: process.env.MONGODB_TEST,
    usernameField: 'username',
    usersCollection: 'shim_users',
    projectsCollection: 'shim_projects',
    annotationsCollection: 'shim_annotations'
  });
  out.healthy = db.checkHealth();
  out.monkLoadedAfterInit = monkLoaded();
  const m1 = db.mongoDB();
  const m2 = db.mongoDB();
  out.sameInstance = m1 === m2;
  out.monkLoadedAfterCall = monkLoaded();
  await m1.get('shim_users').insert({ username: 'viaMonk' });
  out.nativeSeesMonkWrite = Boolean(await db.nativeMongoDB().collection('shim_users').findOne({ username: 'viaMonk' }));
  await db.nativeMongoDB().collection('shim_users').drop();
  await db.close();
  out.healthyAfterClose = db.checkHealth();
  console.log('RESULT ' + JSON.stringify(out));
})().catch((e) => { console.log('RESULT ' + JSON.stringify({ error: e.message })); });
`;

describe('db: native client, lazy monk shim, health', () => {
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
    expect(result.monkLoadedAfterInit).to.equal(false);
  });

  it('mongoDB() creates one monk instance on the same database, on first call', () => {
    expect(result.monkLoadedAfterCall).to.equal(true);
    expect(result.sameInstance).to.equal(true);
    expect(result.nativeSeesMonkWrite).to.equal(true);
  });

  it('mongoDB() warns once that it is deprecated', () => {
    // (monk's mongodb 3.7 adds warnings of its own)
    expect(result.warnings.filter((w) => w.endsWith(':NWL_MONK'))).to.deep.equal(['DeprecationWarning:NWL_MONK']);
  });

  it('checkHealth() follows the client: false once closed', () => {
    expect(result.healthyAfterClose).to.equal(false);
  });
});
