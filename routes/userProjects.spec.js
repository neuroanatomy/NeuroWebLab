const { assert } = require('chai');
const Configuration = require('../Configuration');
const { userProjectsRoute, userProjectsQuery, queryCount } = require('./userProjects');

/* A fake response: records the status and the JSON answered */
const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;

    return res;
  };
  res.json = (body) => {
    res.body = body;

    return res;
  };

  return res;
};

/* A Db stub: records the collection and the query, answers `docs` (or rejects with `fail`) */
const stubDb = (docs, { fail } = {}) => {
  const calls = [];
  const db = {
    calls,
    collection: (name) => ({
      find: (query) => {
        calls.push({ name, query });

        return { toArray: () => (fail ? Promise.reject(fail) : Promise.resolve(docs)) };
      }
    })
  };

  return db;
};

// p0 … p9; the even ones visible
const DOCS = Array.from({ length: 10 }, (_, i) => ({ shortname: `p${i}`, visible: i % 2 === 0 }));
const VISIBLE = ['p0', 'p2', 'p4', 'p6', 'p8'];

// eslint-disable-next-line max-lines-per-function, max-statements
describe('routes/userProjects', () => {
  let savedProperties;

  before(() => {
    savedProperties = Configuration.getInstance().properties;
    Configuration.getInstance().setProperties({ ...savedProperties, projectsCollection: 'theProjects' });
  });
  after(() => {
    Configuration.getInstance().setProperties(savedProperties);
  });

  /* An adapter over the stub: the visible ones, rows as shortnames, the answer as is */
  const adapter = (db, more = {}) => ({
    db: () => db,
    canView: (req, project) => project.visible,
    rows: (req, page) => page.map((p) => p.shortname),
    answer: (list) => ({ list }),
    ...more
  });

  /* Run the route: the response, and next's argument (undefined if not called) */
  const run = async (theAdapter, query = {}, userName = 'ada') => {
    const res = fakeRes();
    let passed;
    await userProjectsRoute(theAdapter)({ params: { userName }, query }, res, (err) => { passed = err; });

    return { res, passed };
  };

  it('one query on the configured collection: the owner, or a row by userID, username or nickname; current versions only', async () => {
    const db = stubDb([]);
    await run(adapter(db), {}, 'ada');
    assert.strictEqual(db.calls.length, 1);
    assert.strictEqual(db.calls[0].name, 'theProjects');
    assert.deepEqual(db.calls[0].query, {
      $or: [
        { owner: 'ada' },
        { 'collaborators.list.userID': 'ada' },
        { 'collaborators.list.username': 'ada' },
        { 'collaborators.list.nickname': 'ada' }
      ],
      backup: { $exists: false }
    });
    assert.deepEqual(userProjectsQuery('ada'), db.calls[0].query);
  });

  it('without start and length: every visible project, in the order read', async () => {
    const { res } = await run(adapter(stubDb(DOCS)));
    assert.strictEqual(res.statusCode, 200);
    assert.deepEqual(res.body, { list: VISIBLE });
  });

  it('filtered by canView, then sliced', async () => {
    const { res } = await run(adapter(stubDb(DOCS)), { start: '1', length: '2' });
    assert.deepEqual(res.body.list, ['p2', 'p4']);
    const second = await run(adapter(stubDb(DOCS)), { start: '3', length: '3' });
    assert.deepEqual(second.res.body.list, ['p6', 'p8']);
  });

  it('canView is given the request and each project, and may return a promise', async () => {
    const seen = [];
    const req = { params: { userName: 'ada' }, query: {} };
    const res = fakeRes();
    const theAdapter = adapter(stubDb(DOCS), {
      canView: (r, p) => {
        seen.push([r, p.shortname]);

        return Promise.resolve(p.visible);
      }
    });
    await userProjectsRoute(theAdapter)(req, res, (err) => { throw err; });
    assert.deepEqual(seen.map(([, s]) => s), DOCS.map((d) => d.shortname));
    assert.isTrue(seen.every(([r]) => r === req));
    assert.deepEqual(res.body.list, VISIBLE);
  });

  it('rows is given the request and the page only, and may return a promise', async () => {
    const calls = [];
    const theAdapter = adapter(stubDb(DOCS), {
      rows: (req, page) => {
        calls.push(page.map((p) => p.shortname));

        return Promise.resolve(page.map((p) => ({ row: p.shortname })));
      }
    });
    const { res } = await run(theAdapter, { start: '1', length: '2' });
    assert.deepEqual(calls, [['p2', 'p4']]);
    assert.deepEqual(res.body, { list: [{ row: 'p2' }, { row: 'p4' }] });
  });

  it('answer is used as is (BrainBox\'s and microdraw\'s keys)', async () => {
    const brainbox = await run(adapter(stubDb(DOCS), { answer: (list) => ({ success: list.length > 0, list }) }), { start: '50' });
    assert.deepEqual(brainbox.res.body, { success: false, list: [] });
    const microdraw = await run(adapter(stubDb(DOCS), { answer: (list) => ({ successful: true, list }) }), { length: '1' });
    assert.deepEqual(microdraw.res.body, { successful: true, list: ['p0'] });
  });

  it('start or length past the end: an empty page, or the rest', async () => {
    assert.deepEqual((await run(adapter(stubDb(DOCS)), { start: '5', length: '2' })).res.body.list, []);
    assert.deepEqual((await run(adapter(stubDb(DOCS)), { start: '1000' })).res.body.list, []);
    assert.deepEqual((await run(adapter(stubDb(DOCS)), { start: '3', length: '1000' })).res.body.list, ['p6', 'p8']);
    assert.deepEqual((await run(adapter(stubDb(DOCS)), { length: '0' })).res.body.list, []);
  });

  it('a start or length that is not a string of digits counts as not given', async () => {
    const CASES = [
      [{ start: 'abc', length: '2' }, ['p0', 'p2']],
      [{ start: '-1', length: '2' }, ['p0', 'p2']],
      [{ start: '1.5', length: '2' }, ['p0', 'p2']],
      [{ start: '', length: '2' }, ['p0', 'p2']],
      [{ start: ['1', '2'], length: '2' }, ['p0', 'p2']],
      [{ start: '1', length: 'abc' }, VISIBLE.slice(1)],
      [{ start: '1', length: '-1' }, VISIBLE.slice(1)],
      [{ start: '1', length: '' }, VISIBLE.slice(1)],
      [{ start: '1', length: { $gt: '' } }, VISIBLE.slice(1)]
    ];
    for (const [query, expected] of CASES) {
      // eslint-disable-next-line no-await-in-loop
      const { res } = await run(adapter(stubDb(DOCS)), query);
      assert.deepEqual(res.body.list, expected, JSON.stringify(query));
    }
  });

  it('queryCount: digits only, else the fallback', () => {
    assert.strictEqual(queryCount('0', 9), 0);
    assert.strictEqual(queryCount('12', 9), 12);
    for (const value of [undefined, '', ' 3', '3 ', '+3', '-3', '3.0', '1e1', '0x10', 'abc', 3, ['3']]) { // eslint-disable-line no-undefined
      assert.strictEqual(queryCount(value, 9), 9, JSON.stringify(value));
    }
  });

  it('a rejected read goes to next, and nothing is answered', async () => {
    const failure = new Error('read failed');
    const { res, passed } = await run(adapter(stubDb(DOCS, { fail: failure })));
    assert.strictEqual(passed, failure);
    assert.isNull(res.body);
  });

  it('a rejected rows (or canView) goes to next, and nothing is answered', async () => {
    const failure = new Error('rows failed');
    const rows = await run(adapter(stubDb(DOCS), { rows: () => Promise.reject(failure) }));
    assert.strictEqual(rows.passed, failure);
    assert.isNull(rows.res.body);
    const canView = await run(adapter(stubDb(DOCS), { canView: () => { throw failure; } }));
    assert.strictEqual(canView.passed, failure);
    assert.isNull(canView.res.body);
  });

  it('a missing adapter function is a TypeError naming it, at start-up', () => {
    for (const field of ['db', 'canView', 'rows', 'answer']) {
      const theAdapter = adapter(stubDb([]));
      delete theAdapter[field];
      assert.throws(() => userProjectsRoute(theAdapter), TypeError, `userProjectsRoute: adapter.${field} must be a function`);
    }
    assert.throws(() => userProjectsRoute(), TypeError, 'userProjectsRoute: an adapter object is needed');
  });
});
