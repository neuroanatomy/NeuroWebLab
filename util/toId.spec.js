const { assert } = require('chai');
const { ObjectId } = require('mongodb');

const nwl = require('../index');
const { toId } = require('./index');

describe('util: toId', () => {
  const hex = '0123456789abcdef01234567';

  // microdraw admin.spec.js
  it('takes a 24-digit hex string, in either case, and nothing else', () => {
    assert.instanceOf(toId(hex), ObjectId);
    assert.equal(String(toId(hex)), hex);
    assert.equal(String(toId(hex.toUpperCase())), hex);
    // eslint-disable-next-line no-undefined
    for (const bad of ['', 'not-an-id', '0123456789ab', 'z'.repeat(24), `${hex}0`, ` ${hex.slice(1)}`, `${hex}\n`, null, undefined, 5, {}, [hex]]) {
      assert.isNull(toId(bad), JSON.stringify(bad));
    }
  });

  // not tested by either app
  it('takes upper-case and lower-case hex, and mixed case', () => {
    const upper = 'ABCDEF0123456789ABCDEF01';
    assert.equal(String(toId(upper)), upper.toLowerCase());
    assert.equal(String(toId(upper.toLowerCase())), upper.toLowerCase());
    assert.equal(String(toId('AbCdEf0123456789aBcDeF01')), upper.toLowerCase());
  });

  it('refuses a 24-character string that is not hex', () => {
    assert.isNull(toId('0123456789abcdef0123456g'));
    assert.isNull(toId('x'.repeat(24)));
    assert.isNull(toId('0123456789abcdef0123456-'));
  });

  it('refuses what is not a string, even what ObjectId would take', () => {
    // ObjectId takes a number, a 12-byte string, an ObjectId; it makes up an id for null
    for (const bad of [42, 1.5, true, null, new ObjectId(hex), Buffer.from(hex, 'hex'), 'twelve bytes']) {
      assert.isNull(toId(bad), String(bad));
    }
  });

  it('gives an ObjectId of NeuroWebLab\'s driver, the root ObjectId', () => {
    assert.instanceOf(toId(hex), nwl.ObjectId);
    assert.isTrue(toId(hex).equals(new ObjectId(hex)));
  });
});
