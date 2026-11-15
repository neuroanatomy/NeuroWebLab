const { assert } = require('chai');

const dbEscapeRegex = require('../db/escapeRegex');
const { escapeRegex } = require('./index');

// cases of microdraw search.spec.js and of the shared suite (3.8); BrainBox
// tests its copy through /api/userNameQuery only
describe('util: escapeRegex', () => {
  it('escapes every regular expression character', () => {
    const special = '.*+?^${}()|[]\\';
    assert.equal(escapeRegex(special), '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    assert.isTrue(new RegExp(escapeRegex(special)).test(`x${special}y`));
  });

  it('leaves other text as it is', () => {
    assert.equal(escapeRegex('plain text-1_é'), 'plain text-1_é');
  });

  it('matches a catastrophic pattern and a wildcard literally', () => {
    assert.isFalse(new RegExp(escapeRegex('(a+)+$')).test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!'));
    assert.isFalse(new RegExp(escapeRegex('m3d.*')).test('m3dsearch'));
    assert.isTrue(new RegExp(escapeRegex('m3d.*')).test('a m3d.* b'));
  });

  it('is NeuroWebLab\'s own db/escapeRegex', () => {
    assert.strictEqual(escapeRegex, dbEscapeRegex.escapeRegex);
  });
});
