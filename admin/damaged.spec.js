/* eslint-disable max-lines, no-undefined, no-await-in-loop -- one spec for the module; undefined is a value checked; cases run in order */
const crypto = require('crypto');
const _ = require('lodash');
const { assert } = require('chai');
const { ObjectId } = require('mongodb');
const Configuration = require('../Configuration');
const { isLocked, projectKey, withLock } = require('../project/lock');
const { projectVersion, saveProjectVersion } = require('../project/versions');
const {
  BATCH_LENGTH, EXAMPLES, damagedProjects, dateOf, isIncompleteSave, removedFiles, removalEvents
} = require('./damaged');

const COLLECTION = 'theProjects';

// ids one minute apart, in order: a later id is newer, and dateOf reads its time
let idCount = 0;
const newId = () => {
  idCount += 1;

  return new ObjectId(`${(0x60000000 + idCount * 60).toString(16)}${'0'.repeat(16)}`);
};

const sameId = (a, b) => String(a) === String(b);

// a deep copy that keeps the ObjectIds (structuredClone makes them plain objects)
const clone = (v) => {
  if (v instanceof ObjectId || v === null || typeof v !== 'object') {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(clone);
  }

  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
};

/* Whether a document matches the queries the module makes */
const matches = (doc, query) => Object.entries(query).every(([key, cond]) => {
  if (cond && typeof cond === 'object' && !(cond instanceof ObjectId)) {
    if ('$exists' in cond) {
      return (key in doc) === cond.$exists;
    }
    if ('$in' in cond) {
      return cond.$in.some((v) => sameId(v, doc[key]));
    }
    if ('$ne' in cond) {
      return !sameId(cond.$ne, doc[key]);
    }
  }

  return key === '_id' ? sameId(cond, doc[key]) : doc[key] === cond;
});

const byId = (direction) => (a, b) => direction * String(a._id).localeCompare(String(b._id));

const project = (doc, projection) => {
  if (!projection) {
    return clone(doc);
  }
  const copy = { _id: doc._id };
  Object.keys(projection).forEach((key) => {
    if (key in doc) {
      copy[key] = clone(doc[key]);
    }
  });

  return copy;
};

/* A Db stub over arrays of documents, by collection; it records the writes */
const stubDb = (collections = {}) => {
  const data = { log: [], ...clone(collections) };
  const writes = [];
  const of = (name) => {
    data[name] = data[name] || [];

    return data[name];
  };
  const collection = (name) => ({
    distinct: (field) => Promise.resolve([...new Set(of(name).map((d) => d[field]))]),
    find: (query, { projection, sort } = {}) => ({
      toArray: () => {
        const found = of(name).filter((d) => matches(d, query));
        if (sort && sort._id) {
          found.sort(byId(sort._id));
        }

        return Promise.resolve(found.map((d) => project(d, projection)));
      }
    }),
    findOne: (query, { sort } = {}) => {
      const found = of(name).filter((d) => matches(d, query));
      if (sort && sort._id) {
        found.sort(byId(sort._id));
      }

      return Promise.resolve(found.length ? clone(found[0]) : null);
    },
    insertOne: (doc) => {
      if (!doc._id) {
        doc._id = newId();
      }
      of(name).push(clone(doc));
      writes.push({ name, op: 'insertOne', doc });

      return Promise.resolve({ insertedId: doc._id });
    },
    updateMany: (query, update) => {
      of(name).filter((d) => matches(d, query))
        .forEach((d) => Object.assign(d, update.$set));
      writes.push({ name, op: 'updateMany', query, update });

      return Promise.resolve();
    },
    updateOne: (query, update) => {
      const doc = of(name).find((d) => matches(d, query));
      for (const [path, value] of Object.entries(update.$set)) {
        const keys = path.split('.');
        const last = keys.pop();
        keys.reduce((o, k) => o[k], doc)[last] = value;
      }
      writes.push({ name, op: 'updateOne', query, update });

      return Promise.resolve();
    }
  });

  return { collection, data, writes, versions: (shortname) => of(COLLECTION).filter((d) => d.shortname === shortname) };
};

/* microdraw's fileRows: rows {source, name}, plain strings a source without a name */
const fileRows = (version) => ((version.files && Array.isArray(version.files.list)) ? version.files.list : []).map((r) => (typeof r === 'string' ? { source: r, name: '' } : { source: r.source, name: r.name || '' }));

const row = (i, name = `Name ${i}`) => ({ source: `https://example.org/f${i}.nii.gz`, name });
const src = (i) => row(i).source;
const range = (n) => Array.from({ length: n }, (x, i) => i);

/* A version of `shortname` with these files, in order of creation */
const version = (shortname, list, more = {}) => ({ _id: newId(), shortname, name: `Project ${shortname}`, owner: 'olga', files: { list }, ...more });

// eslint-disable-next-line max-lines-per-function, max-statements
describe('admin/damaged', () => {
  let savedProperties;

  before(() => {
    savedProperties = Configuration.getInstance().properties;
    Configuration.getInstance().setProperties({ ...savedProperties, projectsCollection: COLLECTION });
  });
  after(() => {
    Configuration.getInstance().setProperties(savedProperties);
  });

  /* The adapter of the tests: microdraw's rows, annotations given, NWL's save, the project key */
  const adapter = (more = {}) => {
    const calls = { annotatedFiles: [], save: [], lockKeys: [] };
    const tools = damagedProjects({
      sourcesOf: fileRows,
      annotatedFiles: (db, shortname, sources) => {
        calls.annotatedFiles.push({ shortname, sources });

        return Promise.resolve(new Set(sources.filter((s) => (/f[02]\./).test(s))));
      },
      save: (db, doc, options) => {
        calls.save.push({ doc: clone(doc), options: clone(options), locked: isLocked(projectKey(doc.shortname)) });

        return saveProjectVersion(db, doc, { by: options.by });
      },
      lockKeys: (shortname) => {
        calls.lockKeys.push(shortname);

        return [projectKey(shortname)];
      },
      ...more
    });

    return { ...tools, calls };
  };

  describe('the helpers', () => {
    it('BATCH_LENGTH is 100, EXAMPLES 3', () => {
      assert.strictEqual(BATCH_LENGTH, 100);
      assert.strictEqual(EXAMPLES, 3);
    });

    it('isIncompleteSave: fewer files, a multiple of 100 of them, the first ones of the previous version', () => {
      const before = range(250).map(src);
      assert.isTrue(isIncompleteSave(before, before.slice(0, 200)));
      assert.isTrue(isIncompleteSave(before, before.slice(0, 100)));
      assert.isTrue(isIncompleteSave(before, []));
      assert.isFalse(isIncompleteSave(before, before.slice(0, 150)), 'not a multiple of 100');
      assert.isFalse(isIncompleteSave(before, before.slice(1, 101)), 'not the first ones');
      assert.isFalse(isIncompleteSave(before, before), 'not fewer');
      assert.isFalse(isIncompleteSave([], []));
    });

    it('removedFiles: the sources of the version the next one lacks, in order, each once', () => {
      assert.deepEqual(removedFiles(['a', 'b', 'c', 'b', 'd'], ['c']), ['a', 'b', 'd']);
      assert.deepEqual(removedFiles(['a'], ['a', 'b']), []);
      assert.deepEqual(removedFiles([], []), []);
    });

    it('dateOf: `modified` if a string, else the time of the _id, else null', () => {
      const id = new ObjectId('600000000000000000000000');
      assert.strictEqual(dateOf({ _id: id, modified: '2026-11-01T00:00:00.000Z' }), '2026-11-01T00:00:00.000Z');
      assert.strictEqual(dateOf({ _id: id, modified: 12 }), id.getTimestamp().toJSON());
      assert.strictEqual(dateOf({ _id: id }), new Date(0x60000000 * 1000).toJSON());
      assert.isNull(dateOf({ _id: 'v1' }));
      assert.isNull(dateOf({}));
    });

    it('removalEvents: the saves that removed files still missing, rows and old plain strings mixed, compared by source', () => {
      const v1 = version('p', [src(0), row(1), src(2), row(3)], { modified: '2026-01-01T00:00:00.000Z', modifiedBy: 'olga' });
      // f0 a string before, a row now: the same file; f1 removed, then put back; f2 and f3 removed
      const v2 = version('p', [row(0)]);
      const v3 = version('p', [row(0), src(1)], { modifiedBy: 'ada' });
      const events = removalEvents([v1, v2, v3], new Set([src(0), src(1)]), fileRows);
      assert.deepEqual(events, [
        {
          save: String(v2._id),
          previous: String(v1._id),
          modified: v2._id.getTimestamp().toJSON(),
          modifiedBy: null,
          before: 4,
          after: 1,
          removed: 3,
          stillMissing: [src(2), src(3)],
          incomplete: false
        }
      ]);
      assert.deepEqual(removalEvents([v1], new Set(), fileRows), [], 'a single version');
    });

    it('removalEvents: a row without a string source is not a file', () => {
      const v1 = version('p', [{ name: 'no source' }, null, row(0)].filter((r) => r !== null));
      const v2 = version('p', []);
      const events = removalEvents([v1, v2], new Set(), fileRows);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].before, 1);
      assert.deepEqual(events[0].stillMissing, [src(0)]);
      assert.isTrue(events[0].incomplete, 'kept 0 files of 1');
    });
  });

  describe('damagedProjects(adapter)', () => {
    it('a missing adapter function is a TypeError naming it', () => {
      const full = { sourcesOf: fileRows, annotatedFiles: () => Promise.resolve(new Set()), save: () => Promise.resolve(), lockKeys: (s) => [s] };
      for (const field of ['sourcesOf', 'annotatedFiles', 'save', 'lockKeys']) {
        const partial = { ...full, [field]: 'not a function' };
        assert.throws(() => damagedProjects(partial), TypeError, `damagedProjects: adapter.${field} must be a function`);
      }
      assert.throws(() => damagedProjects(), TypeError, 'damagedProjects: an adapter object is needed');
      assert.throws(() => damagedProjects(null), TypeError, 'an adapter object is needed');
      assert.hasAllKeys(damagedProjects(full), ['findDamagedProjects', 'restoreFiles', 'fixCurrentVersions', 'isIncompleteSave']);
      assert.strictEqual(damagedProjects(full).isIncompleteSave, isIncompleteSave);
    });
  });

  describe('findDamagedProjects', () => {
    it('lists microdraw\'s entry: the token of the current version, the events with their counts and examples', async () => {
      const v1 = version('dmg', range(6).map(row), { modifiedBy: 'olga' });
      const v2 = version('dmg', [row(5)], { modified: '2026-11-01T10:00:00.000Z', modifiedBy: 'ada' });
      const db = stubDb({ [COLLECTION]: [{ ...v1, backup: true }, v2] });
      const tools = adapter();
      const { list } = await tools.findDamagedProjects(db);
      const [, current] = db.versions('dmg');
      assert.deepEqual(list, [
        {
          shortname: 'dmg',
          name: 'Project dmg',
          owner: 'olga',
          version: projectVersion(current),
          files: 1,
          versions: 2,
          currentVersions: [{ id: String(v2._id), modified: '2026-11-01T10:00:00.000Z', modifiedBy: 'ada' }],
          missing: 5,
          suspected: false,
          events: [
            {
              save: String(v2._id),
              previous: String(v1._id),
              modified: '2026-11-01T10:00:00.000Z',
              modifiedBy: 'ada',
              before: 6,
              after: 1,
              removed: 5,
              stillMissing: 5,
              annotated: 2,
              incomplete: false,
              examples: [src(0), src(1), src(2)]
            }
          ]
        }
      ]);
      assert.deepEqual(tools.calls.annotatedFiles, [{ shortname: 'dmg', sources: range(5).map(src) }]);
    });

    it('skips a deleted project, an undamaged one and a shortname that is not a string; no annotations read without missing files', async () => {
      const db = stubDb({
        [COLLECTION]: [
          { ...version('gone', [row(0)]), backup: true },
          { ...version('gone', []), backup: true },
          { ...version('fine', [row(0)]), backup: true },
          version('fine', [row(0), row(1)]),
          version(null, []),
          version('', [])
        ]
      });
      const tools = adapter();
      assert.deepEqual(await tools.findDamagedProjects(db), { list: [] });
      assert.deepEqual(tools.calls.annotatedFiles, []);
    });

    it('flags an incomplete save (the first 100 files kept) as suspected, and lists several current versions without events', async () => {
      const db = stubDb({
        [COLLECTION]: [
          { ...version('inc', range(101).map(row)), backup: true },
          version('inc', range(100).map(row)),
          version('two', [row(0)]),
          version('two', [row(0)])
        ]
      });
      const { list } = await adapter().findDamagedProjects(db);
      assert.deepEqual(list.map((e) => [e.shortname, e.suspected, e.missing, e.currentVersions.length, e.events.length]), [
        ['inc', true, 1, 1, 1],
        ['two', false, 0, 2, 0]
      ]);
      assert.isTrue(list[0].events[0].incomplete);
      // of two current versions, the newest is the token's (findCurrentProject)
      assert.strictEqual(list[1].version, projectVersion(db.versions('two')[1]));
    });

    it('sorts suspected first, then most missing, then by shortname', async () => {
      const lost = (shortname, n) => [{ ...version(shortname, range(n + 1).map(row)), backup: true }, version(shortname, [row(n)])];
      const db = stubDb({
        [COLLECTION]: [
          ...lost('b', 2),
          ...lost('a', 2),
          ...lost('c', 5),
          { ...version('s', range(101).map(row)), backup: true },
          version('s', range(100).map(row))
        ]
      });
      const { list } = await adapter().findDamagedProjects(db);
      assert.deepEqual(list.map((e) => e.shortname), ['s', 'c', 'a', 'b']);
    });
  });

  describe('restoreFiles', () => {

    /* A project whose second save removed f1 and f2 (named), its current version f0, f3 */
    const damaged = () => {
      const v1 = { ...version('rst', [row(0), row(1, 'First name'), src(2), row(3)]), backup: true };
      const v2 = { ...version('rst', [row(0), row(3)]), backup: true };
      const v3 = version('rst', [src(0), row(3, 'Renamed')], { description: 'kept' });
      const db = stubDb({ [COLLECTION]: [v1, v2, v3] });

      return { db, v1, v2, v3, token: projectVersion(db.versions('rst')[2]) };
    };
    const params = (d, more = {}) => ({ shortname: 'rst', version: d.token, save: String(d.v2._id), username: 'admin', ...more });
    const unchanged = (d, count = 3) => {
      assert.strictEqual(d.db.versions('rst').length, count, 'no version stored');
      assert.deepEqual(d.db.data.log, [], 'no log entry');
    };

    // eslint-disable-next-line max-statements
    it('adds the missing rows back after the current ones, with the names they had, as a new version, under the lock', async () => {
      const d = damaged();
      const tools = adapter();
      const answer = await tools.restoreFiles(d.db, params(d));
      const versions = d.db.versions('rst');
      assert.strictEqual(versions.length, 4);
      const current = versions.filter((v) => !v.backup);
      assert.strictEqual(current.length, 1);
      assert.deepEqual(current[0].files.list, [src(0), row(3, 'Renamed'), row(1, 'First name'), { source: src(2), name: '' }]);
      assert.strictEqual(current[0].description, 'kept');
      assert.strictEqual(current[0].modifiedBy, 'admin');
      // save got the rows, the user and the previous document, holding the lock of lockKeys
      assert.strictEqual(tools.calls.save.length, 1);
      assert.deepEqual(tools.calls.save[0].doc.files.list, current[0].files.list);
      assert.strictEqual(tools.calls.save[0].options.by, 'admin');
      assert.deepEqual(tools.calls.save[0].options.previous, clone(d.v3));
      assert.isTrue(tools.calls.save[0].locked);
      assert.deepEqual(tools.calls.lockKeys, ['rst']);
      assert.isFalse(isLocked(projectKey('rst')));
      // the answer and the log entry, with the previous document and the after token
      const after = projectVersion(current[0]);
      const [entry] = d.db.data.log;
      assert.deepEqual(answer, { restored: 2, files: 4, version: after, log: String(entry._id) });
      assert.strictEqual(entry.key, 'adminRestoreProjectFiles');
      assert.deepEqual(entry.value, {
        username: 'admin',
        shortname: 'rst',
        before: d.token,
        save: String(d.v2._id),
        files: [src(1), src(2)],
        project: _.omit(clone(d.v3), ['_id']),
        after
      });
      assert.notProperty(entry.value.project, '_id');
      assert.isString(entry.date);
      // the log entry is written before the save, the after token after it
      assert.deepEqual(d.db.writes.map((w) => `${w.name} ${w.op}`), ['log insertOne', `${COLLECTION} insertOne`, `${COLLECTION} updateMany`, 'log updateOne']);
    });

    // eslint-disable-next-line max-statements
    it('refuses, in order: 400 a save that is not an id, 404 no current version, 409 several, 409 a stale token, 404 no such save, 409 nothing to restore; nothing stored', async () => {
      let d = damaged();
      const tools = adapter();
      for (const save of [undefined, '', 'v2', '1234', 42]) {
        assert.deepEqual(await tools.restoreFiles(d.db, params(d, { save })), { status: 400, error: 'Provide the save: the id of the version it stored, as listed' });
      }
      assert.deepEqual(await tools.restoreFiles(d.db, params(d, { shortname: 'nothere', save: 'abc' })), { status: 400, error: 'Provide the save: the id of the version it stored, as listed' }, 'the id first');
      assert.deepEqual(await tools.restoreFiles(d.db, params(d, { shortname: 'nothere' })), { status: 404, error: 'Project nothere not found' });
      // a stale token
      for (const token of [projectVersion(d.v2), `${d.token.slice(0, -1)}${d.token.endsWith('0') ? '1' : '0'}`, undefined, '']) {
        assert.deepEqual(await tools.restoreFiles(d.db, params(d, { version: token })), { status: 409, error: 'Project rst has changed since it was listed: reload the list' });
      }
      assert.deepEqual(await tools.restoreFiles(d.db, params(d, { save: String(newId()) })), { status: 404, error: 'No save of this project stored that version' });
      assert.deepEqual(await tools.restoreFiles(d.db, params(d, { save: String(d.v1._id) })), { status: 404, error: 'No save of this project stored that version' }, 'the first version is no save');
      assert.deepEqual(await tools.restoreFiles(d.db, params(d, { save: String(d.v3._id) })), { status: 409, error: 'The files that save removed are all in the project' });
      unchanged(d);
      assert.deepEqual(tools.calls.save, []);
      // several current versions come before the token
      d = damaged();
      d.db.data[COLLECTION].push(version('rst', [row(0)]));
      assert.deepEqual(await tools.restoreFiles(d.db, params(d)), { status: 409, error: 'Project rst has 2 current versions: fix that first' });
      unchanged(d, 4);
    });

    it('takes the adapter\'s lock keys (BrainBox\'s), and logs its pino line with the adapter\'s fields', async () => {
      const d = damaged();
      const lines = [];
      const logger = { info: (fields, message) => lines.push({ fields, message }) };
      let held = null;
      const tools = adapter({
        lockKeys: () => ['project', 'mri'],
        save: (db, doc, options) => {
          held = ['project', 'mri'].map(isLocked);

          return saveProjectVersion(db, doc, { by: options.by });
        },
        logger,
        logFields: (v) => ({ shortname: v.shortname })
      });
      await tools.restoreFiles(d.db, params(d));
      assert.deepEqual(held, [true, true]);
      assert.deepEqual(lines, [{ fields: { event: 'adminRestoreProjectFiles', shortname: 'rst' }, message: 'admin: adminRestoreProjectFiles' }]);
      assert.isFalse(isLocked('project'));
    });

    it('waits for the lock: a fix queued behind a save sees the save, and refuses its stale token', async () => {
      const d = damaged();
      const tools = adapter();
      let release;
      const holder = withLock(projectKey('rst'), () => new Promise((resolve) => { release = resolve; }));
      const fix = tools.restoreFiles(d.db, params(d));
      await saveProjectVersion(d.db, { ...d.v3, name: 'changed meanwhile' }, { by: 'olga' });
      release();
      await holder;
      assert.deepEqual(await fix, { status: 409, error: 'Project rst has changed since it was listed: reload the list' });
    });
  });

  describe('fixCurrentVersions', () => {
    const twoCurrent = () => {
      const old = { ...version('fx', [row(0)]), backup: true };
      const a = version('fx', [row(0)]);
      const b = version('fx', [row(0), row(1)]);
      const db = stubDb({ [COLLECTION]: [old, a, b] });

      return { db, old, a, b, token: projectVersion(db.versions('fx')[2]) };
    };

    it('keeps the newest current version, marks the others backup, and logs it, under the lock', async () => {
      const d = twoCurrent();
      const tools = adapter();
      const answer = await tools.fixCurrentVersions(d.db, { shortname: 'fx', version: d.token, username: 'admin' });
      const [entry] = d.db.data.log;
      assert.deepEqual(answer, { kept: String(d.b._id), backups: 1, version: d.token, log: String(entry._id) });
      assert.deepEqual(d.db.versions('fx').map((v) => v.backup === true), [true, true, false]);
      assert.strictEqual(entry.key, 'adminFixCurrentVersions');
      assert.deepEqual(entry.value, { username: 'admin', shortname: 'fx', kept: String(d.b._id), backups: [String(d.a._id)] });
      assert.deepEqual(tools.calls.lockKeys, ['fx']);
      assert.deepEqual(tools.calls.save, [], 'no new version');
    });

    it('refuses, in order: 404 no current version, 409 a stale token (of the newest current version), 409 not several; nothing written', async () => {
      const d = twoCurrent();
      const tools = adapter();
      assert.deepEqual(await tools.fixCurrentVersions(d.db, { shortname: 'nothere', version: d.token, username: 'admin' }), { status: 404, error: 'Project nothere not found' });
      for (const token of [projectVersion(d.db.versions('fx')[1]), 'abc', undefined]) {
        assert.deepEqual(await tools.fixCurrentVersions(d.db, { shortname: 'fx', version: token, username: 'admin' }), { status: 409, error: 'Project fx has changed since it was listed: reload the list' });
      }
      assert.deepEqual(d.db.writes, []);
      const one = stubDb({ [COLLECTION]: [version('one', [row(0)])] });
      const token = projectVersion(one.versions('one')[0]);
      assert.deepEqual(await tools.fixCurrentVersions(one, { shortname: 'one', version: token, username: 'admin' }), { status: 409, error: 'Project one does not have several current versions' });
      assert.deepEqual(one.writes, []);
    });
  });
});

describe('project/versions: projectVersion', () => {
  it('the first 20 hex digits of the sha256 of the JSON (microdraw\'s token, unchanged)', () => {
    const doc = { _id: new ObjectId('600000000000000000000000'), shortname: 'p', files: { list: [row(0)] } };
    const expected = crypto.createHash('sha256').update(JSON.stringify(doc))
      .digest('hex')
      .slice(0, 20);
    assert.strictEqual(projectVersion(doc), expected);
    assert.match(projectVersion(doc), /^[0-9a-f]{20}$/);
    assert.strictEqual(projectVersion(clone(doc)), expected, 'a copy with the same keys in the same order');
  });

  it('changes with any field, and with the order of the keys', () => {
    const doc = { shortname: 'p', name: 'A' };
    assert.notStrictEqual(projectVersion({ ...doc, name: 'B' }), projectVersion(doc));
    assert.notStrictEqual(projectVersion({ name: 'A', shortname: 'p' }), projectVersion(doc));
  });
});
