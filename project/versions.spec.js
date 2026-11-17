const { assert } = require('chai');
const sinon = require('sinon');
const { MongoClient } = require('mongodb');
const { toMongoUri } = require('../db/native');
const Configuration = require('../Configuration');
const { CURRENT, NEWEST_FIRST, findCurrentProject, saveProjectVersion } = require('./versions');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production');
}

// collections of this spec only, dropped after
const COLLECTION = 'nwlVersionsSpec';
const OTHER_COLLECTION = 'nwlVersionsSpecOther';

// eslint-disable-next-line max-statements
describe('project/versions', () => {
  let client;
  let db;
  let savedProperties;

  const projects = () => db.collection(COLLECTION);
  const setCollection = (name) => Configuration.getInstance().setProperties({
    ...savedProperties,
    projectsCollection: name
  });
  const drop = async () => {
    for (const name of [COLLECTION, OTHER_COLLECTION]) {
      // eslint-disable-next-line no-await-in-loop
      if ((await db.listCollections({ name }).toArray()).length) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection(name).drop();
      }
    }
  };
  // inserted in order: each later document has a newer _id
  const insert = async (...docs) => {
    for (const doc of docs) {
      // eslint-disable-next-line no-await-in-loop
      await projects().insertOne({ ...doc });
    }
  };
  const currents = (shortname) => projects().find({ shortname, ...CURRENT }, { sort: { _id: 1 } })
    .toArray();
  const all = (shortname) => projects().find({ shortname }, { sort: { _id: 1 } })
    .toArray();

  before(async () => {
    client = new MongoClient(toMongoUri(mongoDbPath));
    await client.connect();
    db = client.db();
    savedProperties = Configuration.getInstance().properties;
  });

  beforeEach(async () => {
    setCollection(COLLECTION);
    await drop();
  });

  afterEach(() => {
    sinon.restore();
  });

  after(async () => {
    Configuration.getInstance().setProperties(savedProperties);
    await drop();
    await client.close();
  });

  it('CURRENT and NEWEST_FIRST are microdraw\'s', () => {
    assert.deepEqual(CURRENT, { backup: { $exists: false } });
    assert.deepEqual(NEWEST_FIRST, { sort: { _id: -1 } });
  });

  describe('findCurrentProject', () => {
    // microdraw test/api/current-project-version.spec.js, "two current
    // documents for one shortname: the newest _id wins on every read"
    it('of two current documents, the newest _id wins', async () => {
      await insert({ shortname: 'p', name: 'Older current' }, { shortname: 'p', name: 'Newer current' });
      assert.strictEqual((await findCurrentProject(db, 'p')).name, 'Newer current');
    });

    // microdraw test/api/current-project-version.spec.js, "answers 404 when
    // the project has only backups"
    it('only backups: null', async () => {
      await insert({ shortname: 'p', name: 'Only a backup', backup: true });
      assert.isNull(await findCurrentProject(db, 'p'));
    });

    // microdraw currentProject.js: a non-string shortname (NWL's
    // queryProject answered undefined)
    it('a non-string shortname: null, with no query', async () => {
      const spy = sinon.spy(db, 'collection');
      assert.isNull(await findCurrentProject(db));
      for (const shortname of [null, 1, ['p'], { $ne: null }]) {
        // eslint-disable-next-line no-await-in-loop
        assert.isNull(await findCurrentProject(db, shortname));
      }
      assert.strictEqual(spy.callCount, 0);
    });

    it('a backup with a newer _id is never returned', async () => {
      await insert({ shortname: 'p', name: 'Current' }, { shortname: 'p', name: 'Newer backup', backup: true });
      assert.strictEqual((await findCurrentProject(db, 'p')).name, 'Current');
    });

    it('applies projection; without one, the whole document', async () => {
      await insert({ shortname: 'p', name: 'Current', owner: 'ana' });
      assert.deepEqual(await findCurrentProject(db, 'p', { projection: { _id: 0 } }), { shortname: 'p', name: 'Current', owner: 'ana' });
      const whole = await findCurrentProject(db, 'p');
      assert.sameMembers(Object.keys(whole), ['_id', 'shortname', 'name', 'owner']);
    });
  });

  describe('saveProjectVersion', () => {
    it('leaves exactly one current document; the old ones become backups', async () => {
      await insert({ shortname: 'p', name: 'v1', backup: true }, { shortname: 'p', name: 'v2' }, { shortname: 'p', name: 'v3' });
      const saved = await saveProjectVersion(db, { shortname: 'p', name: 'v4' }, { by: 'ana' });
      const docs = await all('p');
      assert.deepEqual(docs.map((d) => [d.name, d.backup === true]), [['v1', true], ['v2', true], ['v3', true], ['v4', false]]);
      assert.deepEqual((await currents('p')).map((d) => String(d._id)), [String(saved._id)]);
      assert.strictEqual((await findCurrentProject(db, 'p')).name, 'v4');
    });

    it('ignores the _id and backup of doc, and does not change doc', async () => {
      await insert({ shortname: 'p', name: 'v1' });
      const stored = await findCurrentProject(db, 'p');
      const doc = { ...stored, name: 'v2', backup: true };
      const copy = structuredClone(doc);
      const saved = await saveProjectVersion(db, doc, { by: 'ana' });
      assert.deepEqual(doc, copy);
      assert.notStrictEqual(String(saved._id), String(stored._id));
      assert.notProperty(saved, 'backup');
      assert.strictEqual((await findCurrentProject(db, 'p')).name, 'v2');
      assert.lengthOf(await all('p'), 2);
    });

    it('sets modified (an ISO string) and modifiedBy (by), and returns the stored copy', async () => {
      const saved = await saveProjectVersion(db, { shortname: 'p', modified: 'old', modifiedBy: 'old' }, { by: 'ana' });
      const stored = await findCurrentProject(db, 'p');
      assert.strictEqual(stored.modified, new Date(stored.modified).toISOString());
      assert.strictEqual(stored.modifiedBy, 'ana');
      assert.deepEqual(saved, stored);
    });

    it('keepModified keeps doc\'s modified and modifiedBy, or keeps them absent', async () => {
      await saveProjectVersion(db, { shortname: 'p', modified: '2020-01-01T00:00:00.000Z', modifiedBy: 'bob' }, { by: 'ana', keepModified: true });
      const kept = await findCurrentProject(db, 'p');
      assert.strictEqual(kept.modified, '2020-01-01T00:00:00.000Z');
      assert.strictEqual(kept.modifiedBy, 'bob');
      await saveProjectVersion(db, { shortname: 'q' }, { by: 'ana', keepModified: true });
      const absent = await findCurrentProject(db, 'q');
      assert.notProperty(absent, 'modified');
      assert.notProperty(absent, 'modifiedBy');
    });

    it('leaves other shortnames untouched', async () => {
      await insert({ shortname: 'p', name: 'p1' }, { shortname: 'other', name: 'o1' }, { shortname: 'other', name: 'o0', backup: true });
      const before = await all('other');
      await saveProjectVersion(db, { shortname: 'p', name: 'p2' }, { by: 'ana' });
      assert.deepEqual(await all('other'), before);
    });

    it('a new project is saved as the only current one', async () => {
      const saved = await saveProjectVersion(db, { shortname: 'new', name: 'New' }, { by: 'ana' });
      const docs = await all('new');
      assert.lengthOf(docs, 1);
      assert.deepEqual(docs[0], saved);
      assert.notProperty(docs[0], 'backup');
    });

    // microdraw test/api/project-versions.spec.js, "crash safety: a failure
    // after the insert leaves two current versions; reads give the newest"
    it('inserts first: if marking fails, the new version is stored, current, and read', async () => {
      await insert({ shortname: 'p', name: 'Before the crash' });
      const failing = Object.create(projects());
      failing.updateMany = () => Promise.reject(new Error('crash after the insert'));
      const crashDb = { collection: (name) => (name === COLLECTION ? failing : db.collection(name)) };
      let caught;
      try {
        await saveProjectVersion(crashDb, { shortname: 'p', name: 'Inserted, not marked' }, { by: 'ana' });
      } catch (err) {
        caught = err;
      }
      assert.strictEqual(caught && caught.message, 'crash after the insert');
      assert.deepEqual((await currents('p')).map((d) => d.name), ['Before the crash', 'Inserted, not marked']);
      assert.strictEqual((await findCurrentProject(db, 'p')).name, 'Inserted, not marked');
      await saveProjectVersion(db, { shortname: 'p', name: 'After the crash' }, { by: 'ana' });
      assert.deepEqual((await currents('p')).map((d) => d.name), ['After the crash']);
    });
  });

  describe('saveProjectVersion: afterSave', () => {
    it('gets the previous version (whole) and the version saved, after both writes', async () => {
      await insert({ shortname: 'p', name: 'v1', files: { list: ['a'] } });
      const stored = await findCurrentProject(db, 'p');
      let seen;
      const afterSave = async (args) => {
        seen = { ...args, currents: await currents('p') };
      };
      const saved = await saveProjectVersion(db, { shortname: 'p', name: 'v2' }, { by: 'ana', afterSave });
      assert.strictEqual(seen.db, db);
      assert.deepEqual(seen.previous, stored);
      assert.strictEqual(seen.version, saved);
      assert.exists(seen.version._id);
      // both writes are done: only the new version is current
      assert.deepEqual(seen.currents.map((d) => d.name), ['v2']);
    });

    it('previous is null for a new project', async () => {
      let seen;
      await saveProjectVersion(db, { shortname: 'new' }, { by: 'ana', afterSave: (args) => { seen = args; } });
      assert.isNull(seen.previous);
      assert.strictEqual(seen.version.shortname, 'new');
    });

    it('its rejection reaches the caller, with the version saved', async () => {
      await insert({ shortname: 'p', name: 'v1' });
      let caught;
      try {
        await saveProjectVersion(db, { shortname: 'p', name: 'v2' }, { by: 'ana', afterSave: () => Promise.reject(new Error('hook failed')) });
      } catch (err) {
        caught = err;
      }
      assert.strictEqual(caught && caught.message, 'hook failed');
      assert.deepEqual((await currents('p')).map((d) => d.name), ['v2']);
    });

    it('without afterSave, one findOne fewer (the previous version is not read)', async () => {
      await insert({ shortname: 'p', name: 'v1' });
      const collection = projects();
      const spyDb = { collection: () => collection };
      const spy = sinon.spy(collection, 'findOne');
      await saveProjectVersion(spyDb, { shortname: 'p', name: 'v2' }, { by: 'ana' });
      assert.strictEqual(spy.callCount, 0);
      await saveProjectVersion(spyDb, { shortname: 'p', name: 'v3' }, { by: 'ana', afterSave: () => null });
      assert.strictEqual(spy.callCount, 1);
    });
  });

  it('the collection follows Configuration, read on each call', async () => {
    await saveProjectVersion(db, { shortname: 'p', name: 'in the first' }, { by: 'ana' });
    setCollection(OTHER_COLLECTION);
    assert.isNull(await findCurrentProject(db, 'p'));
    await saveProjectVersion(db, { shortname: 'p', name: 'in the other' }, { by: 'ana' });
    assert.strictEqual((await findCurrentProject(db, 'p')).name, 'in the other');
    assert.lengthOf(await db.collection(OTHER_COLLECTION).find({ shortname: 'p' })
      .toArray(), 1);
    setCollection(COLLECTION);
    assert.strictEqual((await findCurrentProject(db, 'p')).name, 'in the first');
  });
});
