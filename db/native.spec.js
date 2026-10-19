const { expect } = require('chai');
const mongodb = require('mongodb');
const { ObjectId, toMongoUri, castIds, findOptions, updateResult } = require('./native');

describe('native.js: monk behaviours on the native driver', () => {
  describe('toMongoUri', () => {
    it('adds mongodb:// to a URI without a scheme (as the apps pass it)', () => {
      expect(toMongoUri('localhost:27017/brainbox')).to.equal('mongodb://localhost:27017/brainbox');
      expect(toMongoUri('127.0.0.1:27017/mocha_test')).to.equal('mongodb://127.0.0.1:27017/mocha_test');
    });

    it('keeps a URI that has a scheme', () => {
      expect(toMongoUri('mongodb://localhost:27017/microdraw')).to.equal('mongodb://localhost:27017/microdraw');
      expect(toMongoUri('mongodb+srv://u:p@cluster.example.org/db')).to.equal('mongodb+srv://u:p@cluster.example.org/db');
    });

    it('refuses an empty or missing URI', () => {
      expect(() => toMongoUri('')).to.throw(/MONGO_DB/);
      expect(() => toMongoUri()).to.throw(/MONGO_DB/);
    });
  });

  describe('castIds', () => {
    const hex = '5f0c1d2e3a4b5c6d7e8f9012';
    const hex2 = '5f0c1d2e3a4b5c6d7e8f9013';

    it('casts a string _id to an ObjectId of NeuroWebLab\'s driver', () => {
      const query = castIds({ _id: hex, name: 'x' });
      expect(query._id).to.be.instanceOf(mongodb.ObjectId);
      expect(query._id.toHexString()).to.equal(hex);
      expect(query.name).to.equal('x');
    });

    it('casts $in, $nin and $ne, and _id at any depth', () => {
      const query = castIds({
        $or: [{ _id: { $in: [hex, hex2] } }, { _id: { $nin: [hex] } }],
        sub: { _id: { $ne: hex2 } }
      });
      expect(query.$or[0]._id.$in.map((id) => id.toHexString())).to.deep.equal([hex, hex2]);
      expect(query.$or[1]._id.$nin[0]).to.be.instanceOf(ObjectId);
      expect(query.sub._id.$ne.toHexString()).to.equal(hex2);
    });

    it('casts in place (inserted documents get the cast id)', () => {
      const doc = { _id: hex };
      castIds(doc);
      expect(doc._id).to.be.instanceOf(ObjectId);
    });

    it('casts in update documents and arrays of documents', () => {
      const update = castIds({ $set: { ref: { _id: hex } } });
      expect(update.$set.ref._id).to.be.instanceOf(ObjectId);
      const docs = castIds([{ _id: hex }, { _id: hex2 }]);
      expect(docs.every((d) => d._id instanceof ObjectId)).to.equal(true);
    });

    it('leaves other values alone', () => {
      const id = new ObjectId();
      const date = new Date();
      const query = castIds({ _id: 'not-an-object-id', when: date, other: { _id: id }, n: 1, s: hex });
      expect(query._id).to.equal('not-an-object-id');
      expect(query.when).to.equal(date);
      expect(query.other._id).to.equal(id);
      expect(query.s).to.equal(hex);
      expect(castIds({ _id: { $exists: true } })).to.deep.equal({ _id: { $exists: true } });
      expect(castIds(null)).to.equal(null);
    });
  });

  describe('findOptions', () => {
    it('turns monk\'s fields (array, string, object) into projection', () => {
      expect(findOptions({ fields: ['username', 'name'], limit: 10 })).to.deep.equal({ projection: { username: 1, name: 1 }, limit: 10 });
      expect(findOptions({ fields: 'username -_id' })).to.deep.equal({ projection: { username: 1, _id: 0 } });
      expect(findOptions({ fields: { name: 1 } })).to.deep.equal({ projection: { name: 1 } });
      expect(findOptions(['name'])).to.deep.equal({ projection: { name: 1 } });
    });

    it('keeps native options, and turns a string sort into an object', () => {
      expect(findOptions({ projection: { a: 1 }, skip: 2, limit: 3 })).to.deep.equal({ projection: { a: 1 }, skip: 2, limit: 3 });
      expect(findOptions({ sort: 'name -joined' })).to.deep.equal({ sort: { name: 1, joined: -1 } });
      expect(findOptions()).to.deep.equal({});
    });
  });

  describe('updateResult', () => {
    it('gives the {n, nModified, ok} that monk returned', () => {
      expect(updateResult({ acknowledged: true, matchedCount: 2, modifiedCount: 1, upsertedCount: 0, upsertedId: null }))
        .to.deep.equal({ n: 2, nModified: 1, ok: 1 });
      const id = new ObjectId();
      expect(updateResult({ acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: id }))
        .to.deep.equal({ n: 1, nModified: 0, ok: 1, upserted: [{ index: 0, _id: id }] });
    });
  });
});
