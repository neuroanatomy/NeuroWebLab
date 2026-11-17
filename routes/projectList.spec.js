const { assert } = require('chai');
const sinon = require('sinon');
const { MongoClient } = require('mongodb');
const { toMongoUri } = require('../db/native');
const Configuration = require('../Configuration');
const { projectListRoute, PROJECTS_PER_PAGE, DEFAULT_PROJECTION } = require('./projectList');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production');
}

// the collection of this spec only, dropped after
const COLLECTION = 'nwlProjectListSpec';

const fakeRes = () => {
  const res = { statusCode: 200, body: null, headersSent: false };
  res.status = (code) => {
    res.statusCode = code;

    return res;
  };
  res.json = (body) => {
    res.body = body;
    res.headersSent = true;

    return res;
  };

  return res;
};

const pad = (i) => String(i).padStart(2, '0');

/**
 * The documents stored, in order: 45 public projects, a hidden one after
 * every 3rd, and a backup of every 10th
 * @param {Array<string>} publicNames Filled with the public shortnames
 * @param {Array<string>} hiddenNames Filled with the hidden shortnames
 * @returns {Array<object>} The documents
 */
const documents = (publicNames, hiddenNames) => {
  const docs = [];
  for (let i = 0; i < 45; i += 1) {
    publicNames.push(`pub${pad(i)}`);
    docs.push({ shortname: `pub${pad(i)}`, name: `Public ${i}`, owner: 'o', collaborators: { list: [] }, files: { list: ['a'] }, annotations: { list: [{ big: true }] } });
    if (i % 3 === 0) {
      hiddenNames.push(`hid${pad(i)}`);
      docs.push({ shortname: `hid${pad(i)}`, owner: 'secret', files: { list: [] } });
    }
    if (i % 10 === 0) {
      docs.push({ shortname: `pub${pad(i)}`, owner: 'o', backup: true });
    }
  }

  return docs;
};

// eslint-disable-next-line max-lines-per-function, max-statements
describe('routes/projectList', () => {
  let client;
  let db;
  let savedProperties;
  // in the order stored: 45 public with a hidden one after every 3rd, and backups
  const PUBLIC = [];
  const HIDDEN = [];

  const projects = () => db.collection(COLLECTION);
  const drop = async () => {
    if ((await db.listCollections({ name: COLLECTION }).toArray()).length) {
      await projects().drop();
    }
  };

  const adapter = (more = {}) => ({
    db: () => db,
    canView: (req, project) => project.owner !== 'secret',
    row: (req, project) => project.shortname,
    ...more
  });

  const run = async (route, query) => {
    const res = fakeRes();
    let passed;
    await route({ query }, res, (err) => { passed = err; });

    return { res, passed };
  };
  const page = async (n, more) => (await run(projectListRoute(adapter(more)), { page: n })).res.body;

  before(async () => {
    client = new MongoClient(toMongoUri(mongoDbPath));
    await client.connect();
    db = client.db();
    savedProperties = Configuration.getInstance().properties;
    Configuration.getInstance().setProperties({ ...savedProperties, projectsCollection: COLLECTION });
    await drop();
    await projects().insertMany(documents(PUBLIC, HIDDEN));
  });

  afterEach(() => {
    sinon.restore();
  });

  after(async () => {
    Configuration.getInstance().setProperties(savedProperties);
    await drop();
    await client.close();
  });

  it('PROJECTS_PER_PAGE is 20', () => {
    assert.strictEqual(PROJECTS_PER_PAGE, 20);
  });

  it('throws at creation on a missing or non-function adapter field, naming it; and on a projection that is not an object', () => {
    for (const field of ['db', 'canView', 'row']) {
      const without = adapter();
      delete without[field];
      assert.throws(() => projectListRoute(without), new RegExp(`adapter\\.${field}`), field);
      assert.throws(() => projectListRoute(adapter({ [field]: 1 })), new RegExp(`adapter\\.${field}`), field);
    }
    assert.throws(() => projectListRoute(null), /adapter/);
    assert.throws(() => projectListRoute(adapter({ projection: 'shortname' })), /adapter\.projection/);
    assert.throws(() => projectListRoute(adapter({ projection: null })), /adapter\.projection/);
  });

  it('no page: 200 {error: "Provide the parameter \'page\'"}, before any read', async () => {
    const a = adapter();
    const dbSpy = sinon.spy(a, 'db');
    for (const query of [{}, { page: '' }]) {
      // eslint-disable-next-line no-await-in-loop
      const { res } = await run(projectListRoute(a), query);
      assert.deepEqual([res.statusCode, res.body], [200, { error: 'Provide the parameter \'page\'' }]);
    }
    assert.isFalse(dbSpy.called);
  });

  it('filtered, then paged: full pages before the last, each visible current project once, no hidden one', async () => {
    const pages = [await page('0'), await page('1'), await page('2'), await page('3')];
    assert.deepEqual(pages.map((p) => p.length), [20, 20, 5, 0]);
    assert.deepEqual(pages.flat(), PUBLIC);
    assert.isEmpty(pages.flat().filter((s) => HIDDEN.includes(s)));
  });

  it('a non-numeric or negative page is page 0; parseInt reads "1x" as 1', async () => {
    const first = PUBLIC.slice(0, 20);
    for (const n of ['abc', '-1', '-20', '0']) {
      // eslint-disable-next-line no-await-in-loop
      assert.deepEqual(await page(n), first, n);
    }
    assert.deepEqual(await page('1x'), PUBLIC.slice(20, 40));
  });

  it('the default projection is BrainBox\'s, and is what the adapter sees', async () => {
    assert.deepEqual(DEFAULT_PROJECTION, { _id: 0, shortname: 1, name: 1, owner: 1, collaborators: 1, 'files.list': 1 });
    const row = sinon.spy((req, project) => project);
    const [first] = await page('0', { row });
    assert.deepEqual(first, { shortname: 'pub00', name: 'Public 0', owner: 'o', collaborators: { list: [] }, files: { list: ['a'] } });
  });

  it('a given projection is used', async () => {
    const [first] = await page('0', { row: (req, project) => project, projection: { _id: 0, shortname: 1, owner: 1 } });
    assert.deepEqual(first, { shortname: 'pub00', owner: 'o' });
  });

  it('row gets (req, project), and its promises are awaited, in order', async () => {
    const row = sinon.spy((req, project) => new Promise((resolve) => { setImmediate(() => resolve({ project: project.shortname })); }));
    const res = fakeRes();
    const req = { query: { page: '2' } };
    await projectListRoute(adapter({ row }))(req, res, sinon.spy());
    assert.deepEqual(res.body, PUBLIC.slice(40).map((project) => ({ project })));
    assert.strictEqual(row.firstCall.args[0], req);
    assert.strictEqual(row.callCount, 5, 'row is called for the page only');
  });

  it('canView gets (req, project); a promise is awaited', async () => {
    const canView = sinon.spy((req, project) => Promise.resolve(project.shortname.endsWith('0')));
    const body = await page('0', { canView });
    // in the order stored
    assert.deepEqual(body, ['pub00', 'hid00', 'pub10', 'pub20', 'pub30', 'hid30', 'pub40']);
    assert.strictEqual(canView.firstCall.args[0].query.page, '0');
  });

  it('an error reaches next', async () => {
    const boom = new Error('boom');
    const { res, passed } = await run(projectListRoute(adapter({ row: () => Promise.reject(boom) })), { page: '0' });
    assert.strictEqual(passed, boom);
    assert.isNull(res.body);
  });
});
