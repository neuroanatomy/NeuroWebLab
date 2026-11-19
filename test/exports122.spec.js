const { assert } = require('chai');

const nwl = require('../index');
const routesUserProjects = require('../routes/userProjects');
const user = require('../user');
const userPublicUser = require('../user/publicUser');

// what `require('neuroweblab')` gives the apps, since 1.22.0 (test/exports.spec.js: before)
// 1.22.0
describe('root exports, 1.22.0', () => {
  it('1.22.0: userProjectsRoute is exported, as the module that holds it', () => {
    assert.isFunction(nwl.userProjectsRoute);
    assert.strictEqual(nwl.userProjectsRoute, routesUserProjects.userProjectsRoute);
  });

  it('1.22.0: PUBLIC_USER_FIELDS, publicUser and publicLoggedUser are exported, as the module that holds them', () => {
    for (const name of ['publicUser', 'publicLoggedUser']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], user[name], name);
      assert.strictEqual(nwl[name], userPublicUser[name], name);
    }
    assert.strictEqual(nwl.PUBLIC_USER_FIELDS, userPublicUser.PUBLIC_USER_FIELDS);
    assert.isTrue(Object.isFrozen(nwl.PUBLIC_USER_FIELDS));
    assert.deepEqual(Object.keys(user).sort(), ['PUBLIC_USER_FIELDS', 'publicLoggedUser', 'publicUser']);
  });

  it('every 1.21.0 export is still there', () => {
    ['visitor', 'noViewStatus', 'projectPageRoute', 'projectSettingsRoute', 'projectJsonRoute', 'projectSaveRoute', 'projectDeleteRoute'].forEach((name) => assert.isFunction(nwl[name], name));
  });
});
