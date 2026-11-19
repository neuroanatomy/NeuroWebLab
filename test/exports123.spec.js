const { assert } = require('chai');

const nwl = require('../index');
const admin = require('../admin');
const adminDamaged = require('../admin/damaged');
const project = require('../project');
const projectVersions = require('../project/versions');
const conformanceAdapter = require('../conformance/adapter');
const { ADMIN_RULES } = require('../conformance/runner');

// what `require('neuroweblab')` gives the apps, since 1.23.0 (test/exports122.spec.js: before)
describe('root exports, 1.23.0', () => {
  it('1.23.0: damagedProjects, BATCH_LENGTH and EXAMPLES are exported, as the module that holds them', () => {
    assert.isFunction(nwl.damagedProjects);
    assert.strictEqual(nwl.damagedProjects, adminDamaged.damagedProjects);
    assert.strictEqual(nwl.damagedProjects, admin.damagedProjects);
    assert.strictEqual(nwl.BATCH_LENGTH, 100);
    assert.strictEqual(nwl.EXAMPLES, 3);
    assert.strictEqual(nwl.BATCH_LENGTH, adminDamaged.BATCH_LENGTH);
    assert.strictEqual(nwl.EXAMPLES, adminDamaged.EXAMPLES);
  });

  it('1.23.0: projectVersion is exported, as the module that holds it', () => {
    assert.isFunction(nwl.projectVersion);
    assert.strictEqual(nwl.projectVersion, projectVersions.projectVersion);
    assert.strictEqual(nwl.projectVersion, project.projectVersion);
  });

  it('1.23.0: the suite knows 5.6 and 5.7, and the damaged projects defaults are microdraw\'s', () => {
    assert.includeMembers(ADMIN_RULES, ['5.1', '5.2', '5.4', '5.6', '5.7']);
    const { admin: resolved } = conformanceAdapter.resolveAdapter({ baseURL: 'http://127.0.0.1', removeProject: () => Promise.resolve() });
    assert.strictEqual(resolved.damaged.list, '/admin/json/projects/damaged');
    assert.strictEqual(resolved.damaged.restoreFiles, '/admin/json/projects/restore-files');
    assert.strictEqual(resolved.damaged.fixCurrent, '/admin/json/projects/fix-current');
    assert.deepEqual(resolved.damaged.entry({ shortname: 'p', version: 't', events: [{ save: 's' }] }), { shortname: 'p', version: 't', saves: ['s'] });
    assert.deepEqual(resolved.damaged.restoreBody({ shortname: 'p', version: 't', save: 's' }), { project: 'p', version: 't', save: 's' });
    assert.deepEqual(resolved.damaged.fixBody({ shortname: 'p', version: 't' }), { project: 'p', version: 't' });
    // an adapter replaces one field, the others stay
    const mapped = conformanceAdapter.resolveAdapter({ baseURL: 'x', removeProject: () => null, admin: { damaged: { fixBody: () => ({}) } } });
    assert.deepEqual(mapped.admin.damaged.fixBody(), {});
    assert.strictEqual(mapped.admin.damaged.list, '/admin/json/projects/damaged');
  });

  it('every 1.22.0 export is still there', () => {
    ['userProjectsRoute', 'publicUser', 'publicLoggedUser', 'adminLog', 'sendResult', 'findCurrentProject', 'saveProjectVersion', 'withLock', 'projectKey'].forEach((name) => assert.isFunction(nwl[name], name));
  });
});
