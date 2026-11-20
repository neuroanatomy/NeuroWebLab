/* eslint-disable max-lines-per-function -- one describe per handler */
const { assert } = require('chai');
const sinon = require('sinon');
const nwl = require('../index');
const { damagedProjectsRoutes, projectFromBody } = require('./index');

const fakeRes = () => {
  const res = { sent: [] };
  res.status = (code) => {
    res.statusCode = code;

    return res;
  };
  res.json = (body) => {
    res.sent.push({ status: res.statusCode || 200, body });

    return res;
  };

  return res;
};

const DB = { name: 'the native Db' };
const VERSION = '0123456789abcdef0123';
const SAVE = '60000000000000000000abcd';

// what damagedProjects returns, its calls recorded
const fakeDamaged = (answers = {}) => {
  const calls = [];
  const fn = (name, fallback) => (...args) => {
    calls.push({ name, args });
    const value = name in answers ? answers[name] : fallback;

    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };

  return {
    calls,
    findDamagedProjects: fn('findDamagedProjects', { list: [] }),
    restoreFiles: fn('restoreFiles', { restored: 2, files: 5, version: 'after', log: 'L1' }),
    fixCurrentVersions: fn('fixCurrentVersions', { kept: 'K', backups: 1, version: VERSION, log: 'L2' })
  };
};

const routesOf = (damaged, options = {}) => damagedProjectsRoutes(damaged, {
  nativeDb: (req) => req.db,
  requestUsername: (req) => req.who,
  ...options
});

const request = (body) => ({ db: DB, who: 'admin1', body });

describe('admin/damagedRoutes: projectFromBody', () => {
  it('gives the shortname and the version', () => {
    assert.deepEqual(projectFromBody({ project: 'p1', version: VERSION, save: 'x' }), { shortname: 'p1', version: VERSION });
  });

  it('asks for the project first, then the version', () => {
    const noProject = { error: 'Provide the project shortname' };
    const noVersion = { error: 'Provide the version of the project, as listed' };
    assert.deepEqual(projectFromBody({}), noProject);
    assert.deepEqual(projectFromBody(), noProject);
    assert.deepEqual(projectFromBody(null), noProject);
    assert.deepEqual(projectFromBody({ project: '', version: VERSION }), noProject);
    assert.deepEqual(projectFromBody({ project: 3, version: VERSION }), noProject);
    assert.deepEqual(projectFromBody({ project: 'p1' }), noVersion);
    assert.deepEqual(projectFromBody({ project: 'p1', version: '' }), noVersion);
    assert.deepEqual(projectFromBody({ project: 'p1', version: 7 }), noVersion);
  });

  it('is exported from the root', () => {
    assert.strictEqual(nwl.projectFromBody, projectFromBody);
    assert.strictEqual(nwl.damagedProjectsRoutes, damagedProjectsRoutes);
  });
});

describe('admin/damagedRoutes: damagedProjectsRoutes', () => {
  it('refuses a missing damaged object, function or nativeDb', () => {
    assert.throws(() => damagedProjectsRoutes(null, { nativeDb: () => DB }), TypeError, /damagedProjects/);
    assert.throws(() => damagedProjectsRoutes({ ...fakeDamaged(), restoreFiles: null }, { nativeDb: () => DB }), TypeError, /damaged\.restoreFiles/);
    assert.throws(() => damagedProjectsRoutes(fakeDamaged(), {}), TypeError, /nativeDb/);
    assert.throws(() => damagedProjectsRoutes(fakeDamaged()), TypeError, /nativeDb/);
    assert.throws(() => damagedProjectsRoutes(fakeDamaged(), { nativeDb: () => DB, requestUsername: 'x' }), TypeError, /requestUsername/);
  });

  describe('getDamagedProjects', () => {
    it('answers the list, from the Db of the request', async () => {
      const list = [{ shortname: 'p1', missing: 3 }];
      const damaged = fakeDamaged({ findDamagedProjects: { list } });
      const res = fakeRes();
      await routesOf(damaged).getDamagedProjects(request(), res);
      assert.deepEqual(res.sent, [{ status: 200, body: { success: true, list } }]);
      assert.deepEqual(damaged.calls, [{ name: 'findDamagedProjects', args: [DB] }]);
    });

    it('answers 500 Server error, logged, when the analysis throws', async () => {
      const err = new Error('db down');
      const logger = { error: sinon.spy() };
      const res = fakeRes();
      await routesOf(fakeDamaged({ findDamagedProjects: err }), { logger }).getDamagedProjects(request(), res);
      assert.deepEqual(res.sent, [{ status: 500, body: { success: false, error: 'Server error' } }]);
      assert.isTrue(logger.error.calledOnceWith({ err }, 'admin request failed'));
    });

    it('answers 500 when nativeDb throws', async () => {
      const logger = { error: sinon.spy() };
      const res = fakeRes();
      const nativeDb = () => {
        throw new Error('no Db');
      };
      const routes = routesOf(fakeDamaged(), { logger, nativeDb });
      await routes.getDamagedProjects(request(), res);
      assert.deepEqual(res.sent, [{ status: 500, body: { success: false, error: 'Server error' } }]);
      assert.isTrue(logger.error.calledOnce);
    });

    it('logs with console.log(\'ERROR:\', err) without a logger', async () => {
      const err = new Error('db down');
      const log = sinon.stub(console, 'log');
      const res = fakeRes();
      try {
        await routesOf(fakeDamaged({ findDamagedProjects: err })).getDamagedProjects(request(), res);
      } finally {
        log.restore();
      }
      assert.isTrue(log.calledOnceWith('ERROR:', err));
      assert.strictEqual(res.sent[0].status, 500);
    });
  });

  describe('restoreProjectFiles', () => {
    const cases = [
      [{}, 'Provide the project shortname'],
      [{ project: 'p1' }, 'Provide the version of the project, as listed'],
      [{ project: 'p1', version: VERSION }, 'Provide the save: the id of the version it stored, as listed'],
      [{ project: 'p1', version: VERSION, save: '' }, 'Provide the save: the id of the version it stored, as listed'],
      [{ project: 'p1', version: VERSION, save: 12 }, 'Provide the save: the id of the version it stored, as listed']
    ];
    cases.forEach(([body, error]) => {
      it(`answers 400 '${error}' for ${JSON.stringify(body)}`, () => {
        const damaged = fakeDamaged();
        const res = fakeRes();
        routesOf(damaged).restoreProjectFiles(request(body), res);
        assert.deepEqual(res.sent, [{ status: 400, body: { success: false, error } }]);
        assert.deepEqual(damaged.calls, []);
      });
    });

    it('answers 400 without a body', () => {
      const res = fakeRes();
      routesOf(fakeDamaged()).restoreProjectFiles({ db: DB }, res);
      assert.deepEqual(res.sent, [{ status: 400, body: { success: false, error: 'Provide the project shortname' } }]);
    });

    it('answers 200 with the fix\'s result, the admin\'s username passed', async () => {
      const damaged = fakeDamaged();
      const res = fakeRes();
      await routesOf(damaged).restoreProjectFiles(request({ project: 'p1', version: VERSION, save: SAVE }), res);
      assert.deepEqual(res.sent, [{ status: 200, body: { success: true, restored: 2, files: 5, version: 'after', log: 'L1' } }]);
      assert.deepEqual(damaged.calls, [
        {
          name: 'restoreFiles',
          args: [DB, { shortname: 'p1', version: VERSION, save: SAVE, username: 'admin1' }]
        }
      ]);
    });

    it('passes a 409 through', async () => {
      const error = 'Project p1 has changed since it was listed: reload the list';
      const res = fakeRes();
      await routesOf(fakeDamaged({ restoreFiles: { status: 409, error } }))
        .restoreProjectFiles(request({ project: 'p1', version: VERSION, save: SAVE }), res);
      assert.deepEqual(res.sent, [{ status: 409, body: { success: false, error } }]);
    });

    it('uses NeuroWebLab\'s requestUsername by default', async () => {
      const damaged = fakeDamaged();
      const res = fakeRes();
      await damagedProjectsRoutes(damaged, { nativeDb: () => DB })
        .restoreProjectFiles({ user: { username: 'u2' }, body: { project: 'p1', version: VERSION, save: SAVE } }, res);
      assert.strictEqual(damaged.calls[0].args[1].username, 'u2');
    });
  });

  describe('fixProjectCurrentVersions', () => {
    it('answers 400 with the body\'s problem', () => {
      const damaged = fakeDamaged();
      const res = fakeRes();
      const routes = routesOf(damaged);
      routes.fixProjectCurrentVersions(request({ version: VERSION }), res);
      routes.fixProjectCurrentVersions(request({ project: 'p1' }), res);
      routes.fixProjectCurrentVersions({ db: DB }, res);
      assert.deepEqual(res.sent, [
        { status: 400, body: { success: false, error: 'Provide the project shortname' } },
        { status: 400, body: { success: false, error: 'Provide the version of the project, as listed' } },
        { status: 400, body: { success: false, error: 'Provide the project shortname' } }
      ]);
      assert.deepEqual(damaged.calls, []);
    });

    it('answers 200 with the fix\'s result', async () => {
      const damaged = fakeDamaged();
      const res = fakeRes();
      await routesOf(damaged).fixProjectCurrentVersions(request({ project: 'p1', version: VERSION }), res);
      assert.deepEqual(res.sent, [{ status: 200, body: { success: true, kept: 'K', backups: 1, version: VERSION, log: 'L2' } }]);
      assert.deepEqual(damaged.calls, [
        {
          name: 'fixCurrentVersions',
          args: [DB, { shortname: 'p1', version: VERSION, username: 'admin1' }]
        }
      ]);
    });

    it('passes a 409 and a 404 through', async () => {
      const conflict = 'Project p1 does not have several current versions';
      const res = fakeRes();
      await routesOf(fakeDamaged({ fixCurrentVersions: { status: 409, error: conflict } }))
        .fixProjectCurrentVersions(request({ project: 'p1', version: VERSION }), res);
      await routesOf(fakeDamaged({ fixCurrentVersions: { status: 404, error: 'Project p1 not found' } }))
        .fixProjectCurrentVersions(request({ project: 'p1', version: VERSION }), res);
      assert.deepEqual(res.sent, [
        { status: 409, body: { success: false, error: conflict } },
        { status: 404, body: { success: false, error: 'Project p1 not found' } }
      ]);
    });
  });
});
