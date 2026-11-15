const crypto = require('crypto');
const { assert } = require('chai');
const session = require('express-session');
const Configuration = require('../Configuration');
const { usernameFromCookie } = require('./sessionUser');

const secret = 'sessionUser-spec-secret';
const noop = () => null;

// the cookie express-session sends for a session id: "s:<sid>.<signature>", URI-encoded
const cookieFor = (sid, key = secret) => {
  const signature = crypto.createHmac('sha256', key).update(sid)
    .digest('base64')
    .replace(/[=]+$/, '');

  return `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
};

// a session parser such as the apps', on a memory store holding `users` by session id
const sessionParserWith = (users) => {
  const store = new session.MemoryStore();
  for (const [sid, user] of Object.entries(users)) {
    const data = { cookie: { originalMaxAge: null, expires: null, httpOnly: true, path: '/' } };
    if (user) {
      data.passport = { user };
    }
    store.set(sid, data, noop);
  }

  return session({ secret, store, resave: false, saveUninitialized: false });
};

describe('auth/sessionUser: usernameFromCookie', () => {
  let parser, saved;

  before(() => {
    saved = Configuration.getInstance().properties;
    Configuration.getInstance().setProperties({ ...saved, usernameField: 'nickname' });
    parser = sessionParserWith({
      reduced: { username: 'editor', nickname: 'editor' },
      // microdraw: usernameField 'username'; sessions of NWL >= 0.2.0
      onlyUsername: { username: 'mduser', name: 'MD User' },
      // stored by NeuroWebLab 0.0.1: the whole user document, under the app's key
      old: { nickname: 'olduser', passhash: 'x' },
      emptyName: { username: '' },
      notString: { username: 42 },
      loggedOut: null
    });
  });

  after(() => {
    Configuration.getInstance().setProperties(saved);
  });

  // BrainBox atlas-write-access.spec.js, microdraw sessionUser.js
  it('gives the username of the session', async () => {
    assert.equal(await usernameFromCookie(parser, cookieFor('reduced')), 'editor');
  });

  it('reads the user under "username"', async () => {
    assert.equal(await usernameFromCookie(parser, cookieFor('onlyUsername')), 'mduser');
  });

  it('reads the user under the configured usernameField (sessions stored by earlier versions)', async () => {
    assert.equal(await usernameFromCookie(parser, cookieFor('old')), 'olduser');
  });

  it('does not read a key that is not the configured usernameField', async () => {
    Configuration.getInstance().setProperties({ ...saved, usernameField: 'username' });
    try {
      assert.isNull(await usernameFromCookie(parser, cookieFor('old')));
    } finally {
      Configuration.getInstance().setProperties({ ...saved, usernameField: 'nickname' });
    }
  });

  it('gives null without a cookie, a parser, a session or a user', async () => {
    assert.isNull(await usernameFromCookie(parser));
    assert.isNull(await usernameFromCookie(parser, ''));
    assert.isNull(await usernameFromCookie(parser, 'other=1'));
    assert.isNull(await usernameFromCookie(null, cookieFor('reduced')));
    assert.isNull(await usernameFromCookie(parser, cookieFor('unknown')));
    assert.isNull(await usernameFromCookie(parser, cookieFor('loggedOut')));
    assert.isNull(await usernameFromCookie(parser, cookieFor('emptyName')));
    assert.isNull(await usernameFromCookie(parser, cookieFor('notString')));
  });

  it('gives null for a cookie with a bad signature', async () => {
    assert.isNull(await usernameFromCookie(parser, cookieFor('reduced', 'another-secret')));
    assert.isNull(await usernameFromCookie(parser, 'connect.sid=s%3Areduced.notasignature'));
    // unsigned
    assert.isNull(await usernameFromCookie(parser, 'connect.sid=reduced'));
  });

  it('gives null when the session store fails, or the parser throws', async () => {
    const failing = (req, res, next) => next(new Error('store down'));
    assert.isNull(await usernameFromCookie(failing, cookieFor('reduced')));
    const throwing = () => {
      throw new Error('parser bug');
    };
    assert.isNull(await usernameFromCookie(throwing, cookieFor('reduced')));
  });

  it('reads the session again each time: a logout counts', async () => {
    const users = { live: { username: 'leaving' } };
    const store = new session.MemoryStore();
    store.set('live', { cookie: { path: '/' }, passport: { user: users.live } }, noop);
    const liveParser = session({ secret, store, resave: false, saveUninitialized: false });
    assert.equal(await usernameFromCookie(liveParser, cookieFor('live')), 'leaving');
    store.destroy('live', noop);
    assert.isNull(await usernameFromCookie(liveParser, cookieFor('live')));
  });
});
