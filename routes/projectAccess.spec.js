/* eslint-disable max-lines, no-undefined -- one spec for the five factories; undefined is what is checked */
const { assert } = require('chai');
const sinon = require('sinon');
const passportRequest = require('passport/lib/http/request');
const { authTokenMiddleware } = require('../auth/token');
const { isLocked, projectKey } = require('../project/lock');
const {
  visitor, noViewStatus, projectPageRoute, projectSettingsRoute, projectJsonRoute, projectSaveRoute, projectDeleteRoute
} = require('./projectAccess');

// No database: `db` is a stub whose findOne answers from `stored`, by shortname
const stubDb = (stored, calls = []) => ({
  collection: () => ({
    findOne: (query, options) => {
      calls.push({ query, options });
      const doc = stored[query.shortname];

      return doc instanceof Error ? Promise.reject(doc) : Promise.resolve(doc ? { ...doc } : null);
    }
  })
});

const STORED = {
  pub: { shortname: 'pub', name: 'Public', owner: 'ana', nested: { a: { b: 'deep' } }, text: 'abc' },
  hidden: { shortname: 'hidden', name: 'Hidden', owner: 'ana' }
};

/* A fake response: the status, the body, how it was sent */
const fakeRes = () => {
  const res = { statusCode: 200, body: null, sent: null, headersSent: false };
  res.status = (code) => {
    res.statusCode = code;

    return res;
  };
  for (const how of ['json', 'send']) {
    res[how] = (body) => {
      res.body = body;
      res.sent = how;
      res.headersSent = true;

      return res;
    };
  }

  return res;
};

/* A request as passport and NWL's token middleware leave it: `user` set means logged in */
const fakeReq = ({ user, projectName = 'pub', query = {}, session = {}, url } = {}) => ({
  params: { projectName },
  query,
  session,
  originalUrl: url || `/project/${projectName}`,
  user: user ? { username: user } : undefined,
  isAuthenticated: passportRequest.isAuthenticated
});

/* Run a route: the response, and next's argument (undefined if not called) */
const run = async (route, req) => {
  const res = fakeRes();
  let passed;
  await route(req, res, (err) => { passed = err; });

  return { res, passed };
};

const canViewPub = (req, project) => project.shortname === 'pub';

// eslint-disable-next-line max-lines-per-function, max-statements
describe('routes/projectAccess', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('visitor and noViewStatus', () => {
    it('a session: the username, 403', () => {
      const req = fakeReq({ user: 'ana' });
      assert.strictEqual(visitor(req), 'ana');
      assert.strictEqual(noViewStatus(req), 403);
    });

    it('logged out: null, 401', () => {
      const req = fakeReq();
      assert.isNull(visitor(req));
      assert.strictEqual(noViewStatus(req), 401);
    });

    it('no isAuthenticated (no passport), no request, a user without a string username: null, never a throw', () => {
      assert.isNull(visitor({ user: { username: 'ana' } }));
      assert.isNull(visitor(undefined));
      assert.isNull(visitor(null));
      assert.strictEqual(noViewStatus({}), 401);
      assert.isNull(visitor({ ...fakeReq(), user: { name: 'no username' } }));
      assert.isNull(visitor({ ...fakeReq(), user: { username: 7 } }));
    });

    // the token cases go through NWL's authTokenMiddleware, with a stub token store
    const tokenReq = async (expiryDate) => {
      sinon.stub(console, 'log');
      const req = { ...fakeReq(), params: { projectName: 'pub' }, query: { token: 'tok' } };
      req.app = { db: { findToken: () => Promise.resolve({ token: 'tok', username: 'bob', expiryDate }) } };
      await new Promise((resolve) => { authTokenMiddleware(req, {}, resolve); });
      console.log.restore();

      return req;
    };

    it('a valid token: the token\'s user (req.user is set, isAuthenticated() is true), 403', async () => {
      const req = await tokenReq(new Date(Date.now() + 60000));
      assert.isTrue(req.isTokenAuthenticated);
      assert.isTrue(req.isAuthenticated());
      assert.strictEqual(visitor(req), 'bob');
      assert.strictEqual(noViewStatus(req), 403);
    });

    it('an expired token: logged out (no req.user), 401; microdraw\'s isTokenAuthenticated branches never add a user', async () => {
      const req = await tokenReq(new Date(Date.now() - 60000));
      assert.isFalse(req.isTokenAuthenticated);
      assert.isUndefined(req.user);
      assert.isNull(visitor(req));
      assert.strictEqual(noViewStatus(req), 401);
    });
  });

  describe('at creation: a missing hook is a TypeError naming it', () => {
    const adapters = {
      projectPageRoute: [projectPageRoute, { db: () => null, canView: () => true, render: () => null }],
      projectSettingsRoute: [projectSettingsRoute, { db: () => null, canView: () => true, blankProject: () => ({}), render: () => null }],
      projectJsonRoute: [projectJsonRoute, { db: () => null, canView: () => true, visible: (req, p) => p }],
      projectSaveRoute: [projectSaveRoute, { lockKeys: () => ['k'], save: () => null }],
      projectDeleteRoute: [projectDeleteRoute, { db: () => null, lockKeys: () => ['k'], canRemove: () => true, remove: () => ({}) }]
    };
    for (const [name, [factory, adapter]] of Object.entries(adapters)) {
      it(name, () => {
        assert.doesNotThrow(() => factory(adapter));
        for (const field of Object.keys(adapter)) {
          const without = { ...adapter };
          delete without[field];
          assert.throws(() => factory(without), TypeError, new RegExp(`${name}: adapter\\.${field}`), field);
          assert.throws(() => factory({ ...adapter, [field]: 'x' }), TypeError, new RegExp(`adapter\\.${field}`), field);
        }
        assert.throws(() => factory(), TypeError, /adapter/);
        if ('db' in adapter) {
          assert.throws(() => factory({ ...adapter, projection: null }), TypeError, /adapter\.projection/);
        }
      });
    }
  });

  describe('projectPageRoute', () => {
    const page = (more = {}) => projectPageRoute({
      db: () => stubDb(STORED),
      canView: canViewPub,
      render: (req, res, project) => res.send(`page of ${project.name}`),
      ...more
    });

    it('stores the return path, reads the project without _id, and renders it', async () => {
      const calls = [];
      const req = fakeReq({ url: '/project/pub?x=1' });
      const render = sinon.spy((rq, rs, project) => rs.send(project.name));
      const { res, passed } = await run(page({ db: () => stubDb(STORED, calls), render }), req);
      assert.strictEqual(req.session.returnTo, '/project/pub?x=1');
      assert.deepEqual(calls[0].query, { shortname: 'pub', backup: { $exists: false } });
      assert.deepEqual(calls[0].options.projection, { _id: 0 });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body, 'Public');
      assert.strictEqual(render.firstCall.args[2].shortname, 'pub');
      assert.isUndefined(passed);
    });

    it('a projection given is used ({}: the whole document)', async () => {
      const calls = [];
      await run(page({ db: () => stubDb(STORED, calls), projection: {} }), fakeReq());
      assert.deepEqual(calls[0].options.projection, {});
    });

    it('without a session, no return path and no throw', async () => {
      const req = { ...fakeReq(), session: undefined };
      const { res } = await run(page(), req);
      assert.strictEqual(res.statusCode, 200);
    });

    it('an unknown project: 404 text "Project Not Found", before the view right', async () => {
      const canView = sinon.spy(() => false);
      const { res } = await run(page({ canView }), fakeReq({ projectName: 'nothere' }));
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.sent, 'send');
      assert.strictEqual(res.body, 'Project Not Found');
      assert.isFalse(canView.called);
    });

    it('no view right: 401 logged out, 403 logged in, text "Not authorized to view project", nothing rendered', async () => {
      for (const [user, status] of [[null, 401], ['bob', 403]]) {
        const render = sinon.spy();
        // eslint-disable-next-line no-await-in-loop
        const { res } = await run(page({ render }), fakeReq({ user, projectName: 'hidden' }));
        assert.strictEqual(res.statusCode, status);
        assert.strictEqual(res.body, 'Not authorized to view project');
        assert.isFalse(render.called);
      }
    });

    it('a rejected read, canView or render goes to next', async () => {
      const boom = new Error('boom');
      for (const more of [
        { db: () => stubDb({ pub: boom }) },
        { canView: () => Promise.reject(boom) },
        { render: () => Promise.reject(boom) }
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const { res, passed } = await run(page(more), fakeReq());
        assert.strictEqual(passed, boom);
        assert.isFalse(res.headersSent);
      }
    });
  });

  describe('projectSettingsRoute', () => {
    const blank = (req) => ({ shortname: req.params.projectName, owner: visitor(req), blank: true });
    const settings = (more = {}) => projectSettingsRoute({
      db: () => stubDb(STORED),
      canView: canViewPub,
      blankProject: blank,
      render: (req, res, project, { isNew }) => res.json({ project, isNew }),
      ...more
    });

    it('a stored project: the return path, render with isNew false', async () => {
      const req = fakeReq({ url: '/project/pub/settings' });
      const { res } = await run(settings(), req);
      assert.strictEqual(req.session.returnTo, '/project/pub/settings');
      assert.strictEqual(res.body.project.name, 'Public');
      assert.isFalse(res.body.isNew);
    });

    it('a stored project without the view right: 401 / 403, text "Not authorized to view project"', async () => {
      for (const [user, status] of [[null, 401], ['bob', 403]]) {
        // eslint-disable-next-line no-await-in-loop
        const { res } = await run(settings(), fakeReq({ user, projectName: 'hidden' }));
        assert.strictEqual(res.statusCode, status);
        assert.strictEqual(res.body, 'Not authorized to view project');
      }
    });

    it('no stored project: blankProject, whose view right is not checked, render with isNew true', async () => {
      const canView = sinon.spy(() => false);
      const req = fakeReq({ user: 'bob', projectName: 'fresh', url: '/project/fresh/settings' });
      const { res } = await run(settings({ canView }), req);
      assert.strictEqual(res.statusCode, 200);
      assert.deepEqual(res.body, { project: { shortname: 'fresh', owner: 'bob', blank: true }, isNew: true });
      assert.isFalse(canView.called);
      assert.strictEqual(req.session.returnTo, '/project/fresh/settings');
    });

    it('a rejected read, canView, blankProject or render goes to next', async () => {
      const boom = new Error('boom');
      for (const [more, projectName] of [
        [{ db: () => stubDb({ pub: boom }) }, 'pub'],
        [{ canView: () => Promise.reject(boom) }, 'pub'],
        [{ blankProject: () => Promise.reject(boom) }, 'fresh'],
        [{ render: () => Promise.reject(boom) }, 'pub']
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const { res, passed } = await run(settings(more), fakeReq({ projectName }));
        assert.strictEqual(passed, boom);
        assert.isFalse(res.headersSent);
      }
    });
  });

  describe('projectJsonRoute', () => {
    const json = (more = {}) => projectJsonRoute({
      db: () => stubDb(STORED),
      canView: canViewPub,
      visible: (req, project) => ({ ...project, seenBy: visitor(req) }),
      ...more
    });

    it('what the visitor may see, as JSON; no return path', async () => {
      const req = fakeReq({ user: 'bob' });
      const { res } = await run(json(), req);
      assert.strictEqual(res.sent, 'json');
      assert.strictEqual(res.body.name, 'Public');
      assert.strictEqual(res.body.seenBy, 'bob');
      assert.isUndefined(req.session.returnTo);
    });

    it('an unknown project: 404 {error: "No project <name>"}, before the view right', async () => {
      const canView = sinon.spy(() => false);
      const { res } = await run(json({ canView }), fakeReq({ projectName: 'nothere' }));
      assert.strictEqual(res.statusCode, 404);
      assert.deepEqual(res.body, { error: 'No project nothere' });
      assert.isFalse(canView.called);
    });

    it('no view right: 401 / 403 {error: "Not authorized to view project"}, visible not called', async () => {
      for (const [user, status] of [[null, 401], ['bob', 403]]) {
        const visible = sinon.spy();
        // eslint-disable-next-line no-await-in-loop
        const { res } = await run(json({ visible }), fakeReq({ user, projectName: 'hidden' }));
        assert.strictEqual(res.statusCode, status);
        assert.deepEqual(res.body, { error: 'Not authorized to view project' });
        assert.isFalse(visible.called);
      }
    });

    it('?var=a/b: the value at that path, of what is visible', async () => {
      for (const [path, value] of [['name', 'Public'], ['nested/a/b', 'deep'], ['nested/a', { b: 'deep' }], ['seenBy', null], ['text/length', 3]]) {
        // eslint-disable-next-line no-await-in-loop
        const { res } = await run(json(), fakeReq({ query: { var: path } }));
        assert.strictEqual(res.sent, 'json', path);
        assert.deepEqual(res.body, value, path);
      }
    });

    it('?var= ending on a missing value: res.json(undefined), as before', async () => {
      const { res, passed } = await run(json(), fakeReq({ query: { var: 'nested/nothing' } }));
      assert.strictEqual(res.sent, 'json');
      assert.isUndefined(res.body);
      assert.isUndefined(passed);
    });

    it('?var= through a missing value (or null): a TypeError to next, as before (a 500)', async () => {
      for (const path of ['nothing/deeper', 'seenBy/x', 'nested//b']) {
        // eslint-disable-next-line no-await-in-loop
        const { res, passed } = await run(json(), fakeReq({ query: { var: path } }));
        assert.instanceOf(passed, TypeError, path);
        assert.isFalse(res.headersSent, path);
      }
    });

    it('?var= reaches own properties only: a prototype key is a missing value', async () => {
      for (const path of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
        // eslint-disable-next-line no-await-in-loop
        const { res } = await run(json(), fakeReq({ query: { var: path } }));
        assert.isUndefined(res.body, path);
      }
      // before, `constructor/name` answered "Object"
      const { passed } = await run(json(), fakeReq({ query: { var: 'constructor/name' } }));
      assert.instanceOf(passed, TypeError);
    });

    it('?var= repeated (an array): a TypeError to next, as before', async () => {
      const { passed } = await run(json(), fakeReq({ query: { var: ['name', 'owner'] } }));
      assert.instanceOf(passed, TypeError);
    });

    it('a rejected read, canView or visible goes to next', async () => {
      const boom = new Error('boom');
      for (const more of [
        { db: () => stubDb({ pub: boom }) },
        { canView: () => Promise.reject(boom) },
        { visible: () => Promise.reject(boom) }
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const { res, passed } = await run(json(more), fakeReq());
        assert.strictEqual(passed, boom);
        assert.isFalse(res.headersSent);
      }
    });
  });

  /* A hook that waits until released, to hold the lock */
  const gate = () => {
    let open;
    const opened = new Promise((resolve) => { open = resolve; });

    return { open, opened };
  };
  const tick = () => new Promise((resolve) => { setImmediate(resolve); });

  describe('projectSaveRoute', () => {
    const KEY = projectKey('pub');
    const save = (more = {}) => projectSaveRoute({
      lockKeys: (req) => [projectKey(req.params.projectName)],
      save: (req, res, username) => res.json({ success: true, by: username }),
      ...more
    });
    const NOT_AUTHENTICATED = { success: false, error: 'User not authenticated', message: 'User not authenticated' };

    it('logged in: save(req, res, username), holding the lock', async () => {
      let held;
      const route = save({ save: (req, res, username) => { held = isLocked(KEY); res.json({ by: username }); } });
      const { res } = await run(route, fakeReq({ user: 'ana' }));
      assert.isTrue(held);
      assert.deepEqual(res.body, { by: 'ana' });
      assert.isFalse(isLocked(KEY));
    });

    it('logged out: 401 {success: false, error, message}, without the lock, even while it is held', async () => {
      const g = gate();
      const route = save({ save: () => g.opened });
      const first = run(route, fakeReq({ user: 'ana' }));
      await tick();
      assert.isTrue(isLocked(KEY));
      const lockKeys = sinon.spy(() => [KEY]);
      const saveHook = sinon.spy();
      const { res } = await run(save({ lockKeys, save: saveHook }), fakeReq());
      assert.strictEqual(res.statusCode, 401);
      assert.deepEqual(res.body, NOT_AUTHENTICATED);
      assert.isFalse(lockKeys.called);
      assert.isFalse(saveHook.called);
      g.open();
      await first;
    });

    it('two saves on the same keys run one after the other', async () => {
      const order = [];
      const gates = [gate(), gate()];
      let n = 0;
      const route = save({
        save: async (req, res) => {
          const i = n;
          n += 1;
          order.push(`start ${i}`);
          await gates[i].opened;
          order.push(`end ${i}`);
          res.json({ i });
        }
      });
      const runs = [run(route, fakeReq({ user: 'ana' })), run(route, fakeReq({ user: 'bob' }))];
      await tick();
      assert.deepEqual(order, ['start 0']);
      gates[1].open();
      await tick();
      assert.deepEqual(order, ['start 0'], 'the second save started while the first held the lock');
      gates[0].open();
      await Promise.all(runs);
      assert.deepEqual(order, ['start 0', 'end 0', 'start 1', 'end 1']);
    });

    it('a rejected save goes to next, and releases the lock', async () => {
      const boom = new Error('boom');
      const { passed } = await run(save({ save: () => Promise.reject(boom) }), fakeReq({ user: 'ana' }));
      assert.strictEqual(passed, boom);
      assert.isFalse(isLocked(KEY));
    });

    it('a bad lock key (lockKeys) goes to next, as a TypeError', async () => {
      const { passed } = await run(save({ lockKeys: () => [] }), fakeReq({ user: 'ana' }));
      assert.instanceOf(passed, TypeError);
    });
  });

  describe('projectDeleteRoute', () => {
    const KEYS = ['project', 'mri'];
    const remove = (more = {}) => projectDeleteRoute({
      db: () => stubDb(STORED),
      lockKeys: () => KEYS,
      canRemove: (req, project) => project.owner === visitor(req),
      remove: () => ({ log: 'L1' }),
      ...more
    });

    it('the owner: remove(req, project, username) holding the lock, 200 {success, message, ...extra}', async () => {
      let held;
      const hook = sinon.spy((req, project) => {
        held = KEYS.every(isLocked);

        return project.shortname === 'pub' ? { log: 'L1' } : null;
      });
      const { res } = await run(remove({ remove: hook }), fakeReq({ user: 'ana' }));
      assert.isTrue(held);
      assert.strictEqual(res.statusCode, 200);
      assert.deepEqual(res.body, { success: true, message: 'Project deleted', log: 'L1' });
      assert.strictEqual(hook.firstCall.args[1].shortname, 'pub');
      assert.strictEqual(hook.firstCall.args[2], 'ana');
    });

    it('remove resolving with nothing: 200 {success: true, message: "Project deleted"}', async () => {
      const { res } = await run(remove({ remove: () => undefined }), fakeReq({ user: 'ana' }));
      assert.deepEqual(res.body, { success: true, message: 'Project deleted' });
    });

    it('logged out: 401 {success: false, error, message}, before the read and the lock', async () => {
      const db = sinon.spy(() => stubDb(STORED));
      const lockKeys = sinon.spy(() => KEYS);
      const { res } = await run(remove({ db, lockKeys }), fakeReq());
      assert.strictEqual(res.statusCode, 401);
      assert.deepEqual(res.body, { success: false, error: 'User not authenticated', message: 'User not authenticated' });
      assert.isFalse(db.called);
      assert.isFalse(lockKeys.called);
    });

    it('an unknown project: 404 {success: false, error: "Project not found", message}', async () => {
      const { res } = await run(remove(), fakeReq({ user: 'ana', projectName: 'nothere' }));
      assert.strictEqual(res.statusCode, 404);
      assert.deepEqual(res.body, { success: false, error: 'Project not found', message: 'Project not found' });
    });

    it('no remove right: 403 {success: false, error, message}, nothing removed', async () => {
      const hook = sinon.spy();
      const { res } = await run(remove({ remove: hook }), fakeReq({ user: 'bob' }));
      const reason = 'The user is not allowed to delete this project';
      assert.strictEqual(res.statusCode, 403);
      assert.deepEqual(res.body, { success: false, error: reason, message: reason });
      assert.isFalse(hook.called);
    });

    it('the 404 and the 403 are answered inside the lock: they wait for its holder', async () => {
      for (const [user, projectName, status] of [['ana', 'nothere', 404], ['bob', 'pub', 403]]) {
        const g = gate();
        const holder = run(remove({ remove: () => g.opened }), fakeReq({ user: 'ana' }));
        // eslint-disable-next-line no-await-in-loop
        await tick();
        const waiting = run(remove(), fakeReq({ user, projectName }));
        let answered = false;
        waiting.then(() => { answered = true; });
        // eslint-disable-next-line no-await-in-loop
        await tick();
        assert.isFalse(answered, `${status} answered while the lock was held`);
        g.open();
        // eslint-disable-next-line no-await-in-loop
        const [, { res }] = await Promise.all([holder, waiting]);
        assert.strictEqual(res.statusCode, status);
      }
    });

    it('two deletes on the same keys run one after the other; the second finds the project gone', async () => {
      const stored = { pub: { ...STORED.pub } };
      const order = [];
      const route = remove({
        db: () => stubDb(stored),
        remove: async (req, project, username) => {
          order.push(`start ${username}`);
          await tick();
          delete stored.pub;
          order.push(`end ${username}`);
        }
      });
      const [a, b] = await Promise.all([run(route, fakeReq({ user: 'ana' })), run(route, fakeReq({ user: 'ana' }))]);
      assert.deepEqual(order, ['start ana', 'end ana']);
      assert.strictEqual(a.res.statusCode, 200);
      assert.strictEqual(b.res.statusCode, 404);
    });

    it('a rejected read, canRemove or remove goes to next (a 500), and releases the lock', async () => {
      const boom = new Error('boom');
      for (const more of [
        { db: () => stubDb({ pub: boom }) },
        { canRemove: () => Promise.reject(boom) },
        { remove: () => Promise.reject(boom) }
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const { res, passed } = await run(remove(more), fakeReq({ user: 'ana' }));
        assert.strictEqual(passed, boom);
        assert.isFalse(res.headersSent);
        assert.isFalse(KEYS.some(isLocked));
      }
    });
  });
});
