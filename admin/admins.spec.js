const fs = require('fs');
const os = require('os');
const path = require('path');
const { assert } = require('chai');
const sinon = require('sinon');
const { createAdmins, requestUsername } = require('./index');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwl-admins-'));
const cfgFile = (name, text) => {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, text); // eslint-disable-line no-sync

  return file;
};
const fakeLogger = () => ({ warn: sinon.spy(), error: sinon.spy(), info: sinon.spy() });

// a response that records what was answered
const fakeRes = () => {
  const res = { sent: [] };
  res.status = (code) => {
    res.statusCode = code;

    return res;
  };
  res.json = (body) => {
    res.sent.push({ kind: 'json', status: res.statusCode || 200, body });

    return res;
  };
  res.render = (view, locals) => {
    res.sent.push({ kind: 'render', status: res.statusCode || 200, view, locals });

    return res;
  };

  return res;
};

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true }); // eslint-disable-line no-sync
});

describe('admin/admins: createAdmins', () => {
  it('reads the admins of cfg.json, keeping only non-empty strings', () => {
    const logger = fakeLogger();
    const admins = createAdmins({ cfgPath: cfgFile('list.json', JSON.stringify({ secret: 'x', admins: ['alice', '', 3, null, 'bob', { u: 1 }] })), logger });
    assert.deepEqual(admins.getAdmins(), ['alice', 'bob']);
    assert.isFalse(logger.warn.called);
  });

  it('a cfg.json without an admins array gives an empty list, no warning', () => {
    const logger = fakeLogger();
    assert.deepEqual(createAdmins({ cfgPath: cfgFile('none.json', '{"admins": "alice"}'), logger }).getAdmins(), []);
    assert.isFalse(logger.warn.called);
  });

  it('a missing file gives an empty list and a warning with the error', () => {
    const logger = fakeLogger();
    const admins = createAdmins({ cfgPath: path.join(tmpDir, 'absent.json'), logger });
    assert.deepEqual(admins.getAdmins(), []);
    assert.isTrue(logger.warn.calledOnce);
    const [fields, message] = logger.warn.firstCall.args;
    assert.instanceOf(fields.err, Error);
    assert.strictEqual(fields.err.code, 'ENOENT');
    assert.strictEqual(message, 'cannot read the admins list from cfg.json');
  });

  it('bad JSON gives an empty list and a warning', () => {
    const logger = fakeLogger();
    assert.deepEqual(createAdmins({ cfgPath: cfgFile('bad.json', '{"admins": ['), logger }).getAdmins(), []);
    assert.isTrue(logger.warn.calledOnce);
    assert.instanceOf(logger.warn.firstCall.args[0].err, SyntaxError);
  });

  it('without a logger, warns with console.log as BrainBox did', () => {
    const log = sinon.stub(console, 'log');
    try {
      createAdmins({ cfgPath: path.join(tmpDir, 'absent.json') });
    } finally {
      log.restore();
    }
    assert.isTrue(log.calledOnce);
    assert.strictEqual(log.firstCall.args[0], 'WARNING: cannot read the admins list from cfg.json');
    assert.match(log.firstCall.args[1], /ENOENT/);
  });

  it('without a cfgPath, an empty list and no warning', () => {
    const logger = fakeLogger();
    assert.deepEqual(createAdmins({ logger }).getAdmins(), []);
    assert.deepEqual(createAdmins().getAdmins(), []);
    assert.isFalse(logger.warn.called);
  });

  it('setAdmins replaces the list; getAdmins returns a copy', () => {
    const admins = createAdmins();
    const list = ['alice'];
    admins.setAdmins(list);
    list.push('mallory');
    assert.deepEqual(admins.getAdmins(), ['alice']);
    admins.getAdmins().push('mallory');
    assert.isFalse(admins.isAdmin('mallory'));
    admins.setAdmins(['bob']);
    assert.isFalse(admins.isAdmin('alice'));
    assert.isTrue(admins.isAdmin('bob'));
  });

  it('isAdmin is false for non-strings', () => {
    const admins = createAdmins();
    admins.setAdmins(['alice', '1', 'null', '[object Object]']);
    for (const value of [null, undefined, 1, ['alice'], { username: 'alice' }, {}, true]) { // eslint-disable-line no-undefined
      assert.isFalse(admins.isAdmin(value), String(value));
    }
    assert.isTrue(admins.isAdmin('alice'));
  });

  it('each instance has its own list', () => {
    const a = createAdmins();
    const b = createAdmins();
    a.setAdmins(['alice']);
    assert.isTrue(a.isAdmin('alice'));
    assert.isFalse(b.isAdmin('alice'));
  });

  it('requestUsername: req.user.username when it is a string, else null', () => {
    assert.strictEqual(requestUsername({ user: { username: 'alice' } }), 'alice');
    assert.isNull(requestUsername({}));
    assert.isNull(requestUsername({ user: { username: 3 } }));
    assert.isNull(requestUsername({ user: null }));
    assert.strictEqual(createAdmins().requestUsername, requestUsername);
  });
});

describe('admin/admins: requireAdmin', () => {
  const admins = createAdmins();
  beforeEach(() => admins.setAdmins(['alice']));

  const run = (req) => {
    const res = fakeRes();
    const next = sinon.spy();
    admins.requireAdmin(req, res, next);

    return { res, next };
  };

  it('401 without a user', () => {
    const { res, next } = run({});
    assert.isFalse(next.called);
    assert.deepEqual(res.sent, [{ kind: 'json', status: 401, body: { success: false, error: 'User not authenticated' } }]);
  });

  it('403 for a non-admin', () => {
    const { res, next } = run({ user: { username: 'bob' } });
    assert.isFalse(next.called);
    assert.deepEqual(res.sent, [{ kind: 'json', status: 403, body: { success: false, error: 'Admins only' } }]);
  });

  it('next() for an admin', () => {
    const { res, next } = run({ user: { username: 'alice' } });
    assert.isTrue(next.calledOnceWithExactly());
    assert.deepEqual(res.sent, []);
  });

  it('next() for an admin authenticated by a token (req.user set by authTokenMiddleware, no session)', () => {
    const { next } = run({ user: { username: 'alice', token: 'tok' }, query: { token: 'tok' } });
    assert.isTrue(next.calledOnce);
  });

  it('follows setAdmins', () => {
    admins.setAdmins(['bob']);
    assert.isTrue(run({ user: { username: 'bob' } }).next.calledOnce);
    assert.strictEqual(run({ user: { username: 'alice' } }).res.sent[0].status, 403);
  });
});

describe('admin/admins: adminPage', () => {
  const admins = createAdmins();
  beforeEach(() => admins.setAdmins(['alice']));

  const run = (options, req) => {
    const res = fakeRes();
    admins.adminPage(options)(req, res);

    return res;
  };

  it('401 logged out: returnTo set, askForLogin with title, functionality and the caller\'s fields', () => {
    const req = { session: {}, originalUrl: '/admin?x=1' };
    const res = run({ title: 'App: Admin', loginPrompt: { login: '<a href=\'/auth/github\'>Log in with GitHub</a>' } }, req);
    assert.strictEqual(req.session.returnTo, '/admin?x=1');
    assert.deepEqual(res.sent, [
      {
        kind: 'render',
        status: 401,
        view: 'askForLogin',
        locals: { title: 'App: Admin', functionality: 'use the admin tools', login: '<a href=\'/auth/github\'>Log in with GitHub</a>' }
      }
    ]);
  });

  it('401: loginPrompt may be a function of the request', () => {
    const req = { session: {}, originalUrl: '/admin', user: { name: 'no username' } };
    const loginPrompt = sinon.spy((r) => ({ loggedUser: JSON.stringify(r.user) }));
    const res = run({ title: 'T', loginPrompt }, req);
    assert.isTrue(loginPrompt.calledOnceWithExactly(req));
    assert.deepEqual(res.sent[0].locals, { title: 'T', functionality: 'use the admin tools', loggedUser: '{"name":"no username"}' });
  });

  it('401 without loginPrompt: title and functionality only', () => {
    const res = run({ title: 'T' }, { session: {}, originalUrl: '/admin' });
    assert.deepEqual(res.sent[0].locals, { title: 'T', functionality: 'use the admin tools' });
  });

  it('403 for a non-admin, and no returnTo', () => {
    const req = { session: {}, originalUrl: '/admin', user: { username: 'bob' } };
    const res = run({ title: 'T' }, req);
    assert.notProperty(req.session, 'returnTo');
    assert.deepEqual(res.sent, [{ kind: 'render', status: 403, view: 'error', locals: { message: 'Admins only' } }]);
  });

  it('200 for an admin, with userPayload written for a script', () => {
    const req = { session: {}, user: { username: 'alice', password: 'hash' } };
    const userPayload = sinon.spy((r, username) => ({ username, name: '</script>' }));
    const res = run({ title: 'T', userPayload }, req);
    assert.isTrue(userPayload.calledOnceWithExactly(req, 'alice'));
    assert.deepEqual(res.sent, [
      {
        kind: 'render',
        status: 200,
        view: 'admin',
        locals: { title: 'T', loggedUser: '{"username":"alice","name":"\\u003c/script\\u003e"}' }
      }
    ]);
  });

  it('200 without userPayload: { username } only', () => {
    const res = run({ title: 'T' }, { session: {}, user: { username: 'alice', password: 'hash' } });
    assert.deepEqual(res.sent[0].locals, { title: 'T', loggedUser: '{"username":"alice"}' });
  });
});
