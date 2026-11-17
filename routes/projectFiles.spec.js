const { assert } = require('chai');
const sinon = require('sinon');
const { MongoClient } = require('mongodb');
const { toMongoUri } = require('../db/native');
const Configuration = require('../Configuration');
const { projectFilesRoute, filesSlice } = require('./projectFiles');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production');
}

// the collection of this spec only, dropped after
const COLLECTION = 'nwlProjectFilesSpec';

const FILES = ['f0', 'f1', 'f2', 'f3', 'f4'].map((name) => ({ source: `https://example.org/${name}.nii.gz`, name }));

/* A fake response: records the status and the JSON answered */
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

const fakeReq = (projectName, query) => ({ params: { projectName }, query });

// eslint-disable-next-line max-lines-per-function, max-statements
describe('routes/projectFiles', () => {
  let client;
  let db;
  let savedProperties;

  const projects = () => db.collection(COLLECTION);
  const drop = async () => {
    if ((await db.listCollections({ name: COLLECTION }).toArray()).length) {
      await projects().drop();
    }
  };

  /* An adapter that lets everybody view `pub*` projects, and answers the raw slice with the flag */
  const adapter = (more = {}) => ({
    db: () => db,
    canView: (req, project) => project.shortname.startsWith('pub'),
    noViewStatus: () => 403,
    entries: (req, project, slice, { names }) => ({ slice, names }),
    ...more
  });

  /* Run the route: the response, and next's argument (undefined if not called) */
  const run = async (route, req) => {
    const res = fakeRes();
    let passed;
    await route(req, res, (err) => { passed = err; });

    return { res, passed };
  };

  before(async () => {
    client = new MongoClient(toMongoUri(mongoDbPath));
    await client.connect();
    db = client.db();
    savedProperties = Configuration.getInstance().properties;
    Configuration.getInstance().setProperties({ ...savedProperties, projectsCollection: COLLECTION });
    await drop();
    await projects().insertMany([
      { shortname: 'pub', files: { list: FILES } },
      { shortname: 'pubold', files: { list: FILES.slice(0, 1) }, backup: true },
      { shortname: 'pubold', files: { list: FILES.slice(0, 2) } },
      { shortname: 'pubnolist', files: { list: 'not an array' } },
      { shortname: 'pubnofiles' },
      { shortname: 'hidden', files: { list: FILES } }
    ]);
  });

  afterEach(() => {
    sinon.restore();
  });

  after(async () => {
    Configuration.getInstance().setProperties(savedProperties);
    await drop();
    await client.close();
  });

  describe('at creation', () => {
    it('throws on a missing or non-function adapter field, naming it', () => {
      for (const field of ['db', 'canView', 'noViewStatus', 'entries']) {
        const without = adapter();
        delete without[field];
        assert.throws(() => projectFilesRoute(without), new RegExp(`adapter\\.${field}`), field);
        assert.throws(() => projectFilesRoute(adapter({ [field]: 'x' })), new RegExp(`adapter\\.${field}`), field);
      }
      assert.throws(() => projectFilesRoute(), /adapter/);
    });
  });

  describe('a missing start or length', () => {
    for (const [query, key] of [[{ length: '2' }, 'start'], [{ start: '0' }, 'length'], [{}, 'start']]) {
      it(`${JSON.stringify(query)}: 200 {error: "Provide '${key}'"}, before any read`, async () => {
        const a = adapter();
        const dbSpy = sinon.spy(a, 'db');
        const canView = sinon.spy(a, 'canView');
        const { res, passed } = await run(projectFilesRoute(a), fakeReq('pub', query));
        assert.strictEqual(res.statusCode, 200);
        assert.deepEqual(res.body, { error: `Provide '${key}'` });
        assert.isFalse(dbSpy.called, 'db read');
        assert.isFalse(canView.called);
        assert.isUndefined(passed);
      });
    }

    it('a missing start answers before an unknown project\'s 404', async () => {
      const { res } = await run(projectFilesRoute(adapter()), fakeReq('nosuchproject', { length: '1' }));
      assert.deepEqual([res.statusCode, res.body], [200, { error: 'Provide \'start\'' }]);
    });
  });

  describe('the project', () => {
    it('an unknown project: 404 {error: "No project <name>"}', async () => {
      const entries = sinon.spy();
      const { res } = await run(projectFilesRoute(adapter({ entries })), fakeReq('nosuchproject', { start: '0', length: '1' }));
      assert.deepEqual([res.statusCode, res.body], [404, { error: 'No project nosuchproject' }]);
      assert.isFalse(entries.called);
    });

    it('a project with only backups is unknown', async () => {
      await projects().insertOne({ shortname: 'pubgone', files: { list: FILES }, backup: true });
      const { res } = await run(projectFilesRoute(adapter()), fakeReq('pubgone', { start: '0', length: '1' }));
      assert.strictEqual(res.statusCode, 404);
    });

    it('the current version is read, not a backup', async () => {
      const { res } = await run(projectFilesRoute(adapter()), fakeReq('pubold', { start: '0', length: '10' }));
      assert.deepEqual(res.body.slice, FILES.slice(0, 2));
    });

    it('no view right: adapter.noViewStatus(req) with {error: "Not authorized to view project"}', async () => {
      const noViewStatus = sinon.stub().returns(401);
      const entries = sinon.spy();
      const canView = sinon.spy((req, project) => project.shortname.startsWith('pub'));
      const req = fakeReq('hidden', { start: '0', length: '1' });
      const { res } = await run(projectFilesRoute(adapter({ noViewStatus, entries, canView })), req);
      assert.deepEqual([res.statusCode, res.body], [401, { error: 'Not authorized to view project' }]);
      assert.isTrue(noViewStatus.calledOnceWithExactly(req));
      assert.strictEqual(canView.firstCall.args[0], req);
      assert.strictEqual(canView.firstCall.args[1].shortname, 'hidden');
      assert.isFalse(entries.called);
    });

    it('a canView promise is awaited', async () => {
      const { res } = await run(projectFilesRoute(adapter({ canView: () => Promise.resolve(false) })), fakeReq('pub', { start: '0', length: '1' }));
      assert.strictEqual(res.statusCode, 403);
    });
  });

  describe('the slice', () => {
    const slice = async (query, name = 'pub') => (await run(projectFilesRoute(adapter()), fakeReq(name, query))).res.body.slice;

    it('start=1&length=2: the 2nd and 3rd files, in list order', async () => {
      assert.deepEqual(await slice({ start: '1', length: '2' }), FILES.slice(1, 3));
    });

    it('cut to the list: past its end, []; a length over the end, the rest', async () => {
      assert.deepEqual(await slice({ start: '5', length: '2' }), []);
      assert.deepEqual(await slice({ start: '99', length: '2' }), []);
      assert.deepEqual(await slice({ start: '3', length: '99' }), FILES.slice(3));
    });

    it('a negative or non-numeric start counts as 0', async () => {
      assert.deepEqual(await slice({ start: '-1', length: '2' }), FILES.slice(0, 2));
      assert.deepEqual(await slice({ start: 'abc', length: '2' }), FILES.slice(0, 2));
      assert.deepEqual(await slice({ start: '', length: '2' }), FILES.slice(0, 2));
    });

    it('a negative or non-numeric length counts as 0', async () => {
      assert.deepEqual(await slice({ start: '1', length: '-1' }), []);
      assert.deepEqual(await slice({ start: '1', length: 'abc' }), []);
    });

    it('parseInt: "2abc" is 2', async () => {
      assert.deepEqual(await slice({ start: '2abc', length: '1x' }), FILES.slice(2, 3));
    });

    it('a list that is not an array, or no files: []', async () => {
      assert.deepEqual(await slice({ start: '0', length: '2' }, 'pubnolist'), []);
      assert.deepEqual(await slice({ start: '0', length: '2' }, 'pubnofiles'), []);
    });

    it('filesSlice alone', () => {
      assert.deepEqual(filesSlice({ files: { list: [1, 2, 3] } }, '1', '5'), [2, 3]);
      assert.deepEqual(filesSlice({}, '0', '5'), []);
    });
  });

  describe('the answer', () => {
    it('entries gets (req, project, the raw slice, {names}), and its answer is sent', async () => {
      const entries = sinon.stub().returns([{ mapped: true }]);
      const req = fakeReq('pub', { start: '1', length: '1', names: 'true' });
      const { res } = await run(projectFilesRoute(adapter({ entries })), req);
      assert.deepEqual(res.body, [{ mapped: true }]);
      const [r, project, raw, flags] = entries.firstCall.args;
      assert.strictEqual(r, req);
      assert.strictEqual(project.shortname, 'pub');
      assert.deepEqual(raw, [FILES[1]]);
      assert.deepEqual(flags, { names: true });
    });

    it('names is true only for names=true', async () => {
      for (const [names, expected] of [['true', true], ['1', false], ['TRUE', false], [null, false]]) {
        const query = names === null ? { start: '0', length: '1' } : { start: '0', length: '1', names };
        // eslint-disable-next-line no-await-in-loop
        const { res } = await run(projectFilesRoute(adapter()), fakeReq('pub', query));
        assert.strictEqual(res.body.names, expected, String(names));
      }
    });

    it('an entries promise is awaited', async () => {
      const entries = (req, project, raw) => new Promise((resolve) => { setImmediate(() => resolve(raw.map((f) => f.name))); });
      const { res } = await run(projectFilesRoute(adapter({ entries })), fakeReq('pub', { start: '0', length: '3' }));
      assert.deepEqual(res.body, ['f0', 'f1', 'f2']);
    });

    it('an entries rejection reaches next, and nothing is answered', async () => {
      const boom = new Error('boom');
      const { res, passed } = await run(projectFilesRoute(adapter({ entries: () => Promise.reject(boom) })), fakeReq('pub', { start: '0', length: '1' }));
      assert.strictEqual(passed, boom);
      assert.isNull(res.body);
    });

    it('a failed read reaches next', async () => {
      const boom = new Error('read failed');
      const failing = { collection: () => ({ findOne: () => Promise.reject(boom) }) };
      const { passed } = await run(projectFilesRoute(adapter({ db: () => failing })), fakeReq('pub', { start: '0', length: '1' }));
      assert.strictEqual(passed, boom);
    });
  });
});
