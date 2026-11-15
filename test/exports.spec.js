const { assert } = require('chai');

const nwl = require('../index');
const util = require('../util');
const sessionUser = require('../auth/sessionUser');
const dbEscapeRegex = require('../db/escapeRegex');
const conformance = require('../conformance');
const packageJSON = require('../package.json');

// what `require('neuroweblab')` gives the apps
describe('root exports', () => {
  it('every 1.7.0 export is still there', () => {
    for (const name of ['ObjectId', 'authTokenMiddleware', 'init', 'getTokenEndPoint', 'version', 'AccessLevel', 'AccessType', 'AccessControlService']) {
      assert.property(nwl, name);
      assert.exists(nwl[name], name);
    }
    assert.match(nwl.version(), /^v\d+\.\d+\.\d+$/);
  });

  it('1.8.0: each shared helper is exported, as the module that holds it', () => {
    for (const name of ['escapeRegex', 'jsonForScript', 'jsonForAttribute', 'toId', 'catchErrors']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], util[name], name);
    }
    assert.isFunction(nwl.usernameFromCookie);
    assert.strictEqual(nwl.usernameFromCookie, sessionUser.usernameFromCookie);
    assert.strictEqual(nwl.escapeRegex, dbEscapeRegex.escapeRegex);
  });

  it('toId gives the root ObjectId', () => {
    assert.instanceOf(nwl.toId('0123456789abcdef01234567'), nwl.ObjectId);
  });

  it('deep paths still work (no "exports" field)', () => {
    assert.notProperty(packageJSON, 'exports');
    assert.isFunction(conformance.projectLifecycle);
  });
});
