const { assert } = require('chai');
const Configuration = require('../Configuration');
const { PUBLIC_USER_FIELDS, publicUser, publicLoggedUser } = require('./publicUser');

const FULL = {
  _id: 'id1',
  username: 'ada',
  nickname: 'ada',
  name: 'Ada',
  avatarURL: 'https://example.org/a.png',
  url: 'https://example.org',
  joined: '2026-01-01T00:00:00.000Z',
  passhash: '$2a$10$fixture',
  email: 'ada@example.org',
  token: 'fixture-token',
  strategy: 'local'
};

// eslint-disable-next-line max-lines-per-function
describe('user/publicUser', () => {
  let savedProperties;
  const configure = (usernameField) => {
    Configuration.getInstance().setProperties({ ...savedProperties, usernameField });
  };

  before(() => {
    savedProperties = Configuration.getInstance().properties;
  });
  afterEach(() => {
    Configuration.getInstance().setProperties(savedProperties);
  });

  it('PUBLIC_USER_FIELDS: name, avatarURL, url, joined, frozen', () => {
    assert.deepEqual([...PUBLIC_USER_FIELDS], ['name', 'avatarURL', 'url', 'joined']);
    assert.isTrue(Object.isFrozen(PUBLIC_USER_FIELDS));
  });

  it('keeps the username field and each public field, nothing else (passhash, email, token, _id)', () => {
    assert.deepEqual(publicUser(FULL, 'username'), {
      username: 'ada', name: 'Ada', avatarURL: FULL.avatarURL, url: FULL.url, joined: FULL.joined
    });
    assert.deepEqual(Object.keys(publicUser(FULL, 'nickname')), ['nickname', 'name', 'avatarURL', 'url', 'joined']);
  });

  it('each field alone is kept, and only the fields the document has', () => {
    for (const field of ['username', ...PUBLIC_USER_FIELDS]) {
      assert.deepEqual(publicUser({ [field]: FULL[field], email: 'x@example.org' }, 'username'), { [field]: FULL[field] }, field);
    }
    assert.deepEqual(publicUser({ passhash: 'x', email: 'y' }, 'username'), {});
  });

  it('a stored null is kept; an own undefined is kept as undefined, which JSON drops', () => {
    const shown = publicUser({ username: 'ada', name: null, url: undefined }, 'username'); // eslint-disable-line no-undefined
    assert.deepEqual(Object.keys(shown), ['username', 'name', 'url']);
    assert.isNull(shown.name);
    assert.strictEqual(JSON.stringify(shown), '{"username":"ada","name":null}');
  });

  it('an inherited field is not kept', () => {
    const doc = Object.create({ name: 'Inherited', passhash: 'x' });
    doc.username = 'ada';
    assert.deepEqual(publicUser(doc, 'username'), { username: 'ada' });
  });

  it('a non-object gives {}, and never throws', () => {
    for (const value of [null, undefined, 'ada', 3, true]) { // eslint-disable-line no-undefined
      assert.deepEqual(publicUser(value, 'username'), {}, String(value));
    }
  });

  it('the username field is the configured usernameField by default', () => {
    configure('nickname');
    assert.deepEqual(Object.keys(publicUser(FULL)), ['nickname', 'name', 'avatarURL', 'url', 'joined']);
    configure('username');
    assert.deepEqual(Object.keys(publicUser(FULL)), ['username', 'name', 'avatarURL', 'url', 'joined']);
  });

  it('a given usernameField wins over the configured one', () => {
    configure('username');
    assert.deepEqual(Object.keys(publicUser(FULL, 'nickname')), ['nickname', 'name', 'avatarURL', 'url', 'joined']);
  });

  it('publicLoggedUser: null logged out; else publicUser plus username', () => {
    assert.isNull(publicLoggedUser(null));
    assert.isNull(publicLoggedUser(undefined)); // eslint-disable-line no-undefined
    assert.isNull(publicLoggedUser(false));
    assert.deepEqual(publicLoggedUser(FULL, 'nickname'), {
      nickname: 'ada', name: 'Ada', avatarURL: FULL.avatarURL, url: FULL.url, joined: FULL.joined, username: 'ada'
    });
    configure('nickname');
    assert.deepEqual(publicLoggedUser({ username: 'ada', nickname: 'ada', passhash: 'x' }), { nickname: 'ada', username: 'ada' });
  });
});
