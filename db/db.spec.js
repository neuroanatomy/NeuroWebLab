/* eslint-disable max-lines */
const assert = require('assert');
const {expect} = require('chai');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) { throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production '); }

const mongodb = require('mongodb');
const db = require('./db');
const nwl = require('../index');

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */
const usernameField = 'username';
const usersCollection = 'users';
const projectsCollection = 'projects';
// const annotationsCollection = 'annotations';

// const garbageDb = require('./db');
// garbageDb.init({
//     MONGO_DB: 'GARBAGE_MONGO:27017/GARBAGE_MONGO',
//     overwriteMongoPath: null,
//     callback: () => console.log("garbageDb callback"),
//     usernameField,
//     usersCollection,
//     projectsCollection
// });

const dummyUser = {
  username: 'tommyjones',
  name: 'Tommy Jones',
  age: 14
};
const dummyUser2 = {
  username: 'jessicajones',
  name: 'Jessica Jones',
  age: 55
};
const dummyGithubUser1 = {
  username: 'github1username',
  name: 'github1 name',
  // nickname: 'github1 nickname',
  url: 'github1 url',
  brainboxURL: 'github1 brainbox URL',
  joined: 'github1 joined'
};
// const dummyAnnotation = {
//   fileID: 'dummy fileID 1',
//   user: 'tommyjones', // "user" in annotation is "username" everywhere else
//   annotation: JSON.stringify({
//     annotationKey1: 'dummy annotation 1 annotation value 1',
//     annotationkey2: 'dummy annotation 1 annotation value 2',
//     Regions: ['dummy annotation 1 region1', 'dummy annotation 1 region2']
//   }),
//   Hash: 'abc123'
// };
// const expectedSavedDummy = [
//   {
//     fileID: 'dummy fileID 1',
//     user: 'tommyjones', // "user" in annotation is "username" everywhere else
//     annotation: 'dummy annotation 1 region2',
//     Hash: 'abc123'
//   }, {
//     fileID: 'dummy fileID 1',
//     user: 'tommyjones',
//     annotation: 'dummy annotation 1 region1',
//     Hash: 'abc123'
//   }
// ];
// const dummyAnnotation_updated = {
//   fileID: 'dummy fileID 1',
//   user: 'tommyjones', // "user" in annotation is "username" everywhere else
//   annotation: JSON.stringify({
//     annotationKey1: 'dummy annotation 1 annotation value 1 updated',
//     annotationkey2: 'dummy annotation 1 annotation value 2 updated',
//     Regions: ['dummy annotation 1 updated region1', 'dummy annotation 1 updated region2']
//   }),
//   Hash: 'abc123 updated'
// };
// const expectedSavedDummyUpdated = [
//   {
//     fileID: 'dummy fileID 1',
//     user: 'tommyjones',
//     annotation: 'dummy annotation 1 updated region2',
//     Hash: 'abc123 updated'
//   }, {
//     fileID: 'dummy fileID 1',
//     user: 'tommyjones',
//     annotation: 'dummy annotation 1 updated region1',
//     Hash: 'abc123 updated'
//   }
// ];
// const dummyAnnotation2 = {
//   fileID: 'dummy fileID 2',
//   user: 'anyone',
//   annotation: JSON.stringify({
//     annotationKey1: 'dummy annotation 2 annotation value 1',
//     annotationkey2: 'dummy annotation 2 annotation value 2',
//     Regions: ['dummy annotation 2 region1', 'dummy annotation 2 region2']
//   }),
//   Hash: '123abc'
// };
// const expectedSavedDummy2 = [
//   {
//     fileID: 'dummy fileID 2',
//     user: 'anyone',
//     annotation: 'dummy annotation 2 region1',
//     Hash: '123abc'
//   }, {
//     fileID: 'dummy fileID 2',
//     user: 'anyone',
//     annotation: 'dummy annotation 2 region2',
//     Hash: '123abc'
//   }
// ];

describe('Mocha Started', () => {
  it('Mocha works properly', () => {
    assert.equal(1, 1);
  });
});

describe('testing db.js', () => {
  before(async () => {
    await db.init({
      MONGO_DB: mongoDbPath,
      overwriteMongoPath: null,
      callback: () => console.log('db callback'),
      usernameField,
      usersCollection,
      projectsCollection,
      annotationsCollection: 'annotations'
    });

    await db.nativeMongoDB().dropDatabase();
  });

  after(async () => {
    await db.nativeMongoDB().dropDatabase();
    await db.close();
  });

  it('should show db is in good health', () => {
    expect(db.checkHealth()).to.be.equal(true);
  });

  // it('should show garbage db is in bab health', () => {
  //     expect(garbageDb.checkHealth()).to.be.equal(false)
  // });

  // describe('db operation with bad db health should result in error', () => {
  //     const getTestGarbageDb = ({ prop, arg }) => (done) => (garbageDb[prop](arg)
  //         .then(() => done('should not succeed'))
  //         .catch(e => done()), null)
  //     /**
  //      * somewhat necessary to return NOT a promise. or else mocha will complain
  //      */

  //     /**
  //      * user management
  //      */
  //     it('addUser throws', getTestGarbageDb({prop: 'addUser', arg: dummyUser}))
  //     it('queryUser throws', getTestGarbageDb({prop: 'queryUser', arg: dummyUser}))
  //     it('queryAllUsers throws', getTestGarbageDb({prop: 'queryAllUsers', arg: dummyUser}))
  //     it('updateUser throws', getTestGarbageDb({prop: 'updateUser', arg: dummyUser}))
  //     it('upsertUser throws', getTestGarbageDb({prop: 'upsertUser', arg: dummyUser}))

  //     /**
  //      * annotation managedment
  //      */

  //     it('findAnnotations throws', getTestGarbageDb({prop: 'findAnnotations', arg: dummyAnnotation}))
  //     it('updateAnnotation throws', getTestGarbageDb({prop: 'updateAnnotation', arg: dummyAnnotation}))

  // });

  it('querying the empty mongodb should not yield any results', (done) => {
    db.queryUser({
      username: dummyUser.username
    }).then(() => {
      done('should have been empty, but not really empty');
    })
      .catch((err) => {
        expect(err.message).to.equal('error find one user');
        done();
      });
  });

  describe('testing adding and querying users', () => {

    it('adding user works fine', (done) => {
      db.addUser(dummyUser)
        .then((returnedUser) => {
          expect(returnedUser).to.equal(dummyUser);
          done();
        })
        .catch((e) => done(e));
    });
    it('adding an additional user works fine', (done) => {
      db.addUser(dummyUser2)
        .then((returnedUser) => {
          expect(returnedUser).to.equal(dummyUser2);
          done();
        })
        .catch((e) => done(e));
    });

    it('querying the inserted users should work as expected', (done) => {
      Promise.all([
        db.queryUser({
          username: dummyUser.username
        }),
        db.queryUser({
          username: dummyUser2.username
        })
      ]).then((users) => {
        expect(users).to.deep.equal([
          dummyUser,
          dummyUser2
        ]);
        done();
      })
        .catch((e) => done(e));
    });
  });

  describe('testing adding and querying github users', () => {
    it('should add user fine', (done) => {
      db.addUser(dummyGithubUser1)
        .then((user) => {
          expect(user).to.deep.equal(dummyGithubUser1);
          done();
        })
        .catch(done);
    });

    it('querying the inserted user should work as intended', (done) => {
      db.queryUser({
        username: dummyGithubUser1.username
      })
        .then((user) => {
          expect(user).to.deep.equal(dummyGithubUser1);
          done();
        })
        .catch(done);
    });

    it('update user should work', (done) => {

      const dghu1c = {
        ...dummyGithubUser1,
        joined: 'joined2'
      };
      db.updateUser(dghu1c)
        .then((user) => {
          expect(user).to.deep.equal(dghu1c);
          done();
        })
        .catch(done);
    });

    it('upsert user should work', (done) => {

      const dghu1c = {
        ...dummyGithubUser1,
        joined: 'joined3'
      };

      const githubUser2 = {
        ...dummyGithubUser1,
        username: 'github1 username alt'
      };

      Promise.all([
        db.upsertUser(dghu1c),
        db.updateUser(githubUser2)
      ])
        .then((users) => {
          expect(users).to.deep.equal([
            dghu1c,
            githubUser2
          ]);
          done();
        })
        .catch(done);
    });
  });

  describe('queryAllUsers is exported', () => {
    it('returns the users, with a query and options', async () => {
      expect(db.queryAllUsers).to.be.a('function');
      const all = await db.queryAllUsers();
      expect(all.map((u) => u.username)).to.include.members([dummyUser.username, dummyUser2.username]);
      const one = await db.queryAllUsers({ username: dummyUser.username });
      expect(one).to.have.length(1);
      const limited = await db.queryAllUsers({}, { limit: 1 });
      expect(limited).to.have.length(1);
    });
  });

  describe('searches match the text literally (escaped regex)', () => {
    before(async () => {
      await db.addUser({ username: 'dot.user', name: 'Dot' });
      await db.addUser({ username: 'dotXuser', name: 'DotX' });
      await db.addProject({ shortname: 'proj.one', name: 'P1' });
      await db.addProject({ shortname: 'projXone', name: 'P2' });
      await db.addProject({ shortname: 'other', name: 'P3' });
    });

    it('searchUsers: "." is a dot, not any character', async () => {
      const found = await db.searchUsers({ q: 'dot.' });
      expect(found.map((u) => u.username)).to.deep.equal(['dot.user']);
    });

    it('searchUsers: ".*" matches only names containing ".*"', async () => {
      expect(await db.searchUsers({ q: '.*' })).to.deep.equal([]);
    });

    it('searchUsers: a catastrophic pattern is just text', async () => {
      expect(await db.searchUsers({ q: '(a+)+$' })).to.deep.equal([]);
    });

    it('searchUsers: a plain text still finds by substring', async () => {
      const found = await db.searchUsers({ q: 'jones' });
      expect(found.map((u) => u.username).sort()).to.deep.equal(['jessicajones', 'tommyjones']);
    });

    it('searchUsers: a non-string q is refused', async () => {
      try {
        await db.searchUsers({ q: { $ne: null } });
        expect.fail('should reject');
      } catch (e) {
        expect(e.message).to.match(/q must be a string/);
      }
    });

    it('searchProjects: "." is a dot', async () => {
      const found = await db.searchProjects({ q: 'proj.' });
      expect(found.map((p) => p.shortname)).to.deep.equal(['proj.one']);
    });

    it('searchProjects: ".*" and "(a+)+$" are just text', async () => {
      expect(await db.searchProjects({ q: '.*' })).to.deep.equal([]);
      expect(await db.searchProjects({ q: '(a+)+$' })).to.deep.equal([]);
    });

    it('searchProjects: a non-string q is refused', async () => {
      try {
        await db.searchProjects({ q: ['a'] });
        expect.fail('should reject');
      } catch (e) {
        expect(e.message).to.match(/q must be a string/);
      }
    });

    it('queryAllProjects passes its options (skip/limit) to the database', async () => {
      expect(await db.queryAllProjects({}, { limit: 2 })).to.have.length(2);
      expect(await db.queryAllProjects({ shortname: 'other' })).to.have.length(1);
      expect((await db.queryAllProjects()).length).to.be.at.least(3);
    });
  });

  describe('helpers on the native driver keep 0.2.0\'s results', () => {
    it('nativeMongoDB() is a Db of NeuroWebLab\'s mongodb; ObjectId is exported from it', async () => {
      expect(db.nativeMongoDB()).to.be.instanceOf(mongodb.Db);
      expect(db.ObjectId).to.equal(mongodb.ObjectId);
      expect(nwl.ObjectId).to.equal(mongodb.ObjectId);
      const { insertedId } = await db.nativeMongoDB().collection('objectid_test')
        .insertOne({ a: 1 });
      const found = await db.nativeMongoDB().collection('objectid_test')
        .findOne({ _id: new nwl.ObjectId(insertedId.toHexString()) });
      expect(found.a).to.equal(1);
    });

    it('addUser gives the user an _id; a string _id finds it (cast to ObjectId)', async () => {
      const user = { username: 'castme', name: 'Cast Me' };
      const added = await db.addUser(user);
      expect(added).to.equal(user);
      expect(added._id).to.be.instanceOf(mongodb.ObjectId);
      const found = await db.queryUser({ _id: String(added._id) });
      expect(found.username).to.equal('castme');
      const all = await db.queryAllUsers({ _id: { $in: [String(added._id)] } });
      expect(all).to.have.length(1);
    });

    it('find helpers take monk\'s fields option and return arrays', async () => {
      const users = await db.queryAllUsers({ username: 'castme' }, { fields: ['name', '-_id'] });
      expect(users).to.deep.equal([{ name: 'Cast Me' }]);
      const none = await db.queryAllProjects({ shortname: 'nothing-here' });
      expect(none).to.deep.equal([]);
      expect(await db.queryUserProjects('nobody')).to.deep.equal([]);
    });

    it('queryProject resolves undefined when there is no project', async () => {
      expect(await db.queryProject({ shortname: 'nothing-here' })).to.be.a('undefined');
    });

    it('project writes: upsert inserts then updates ({n, nModified, ok}); delete gives deletedCount', async () => {
      const project = { shortname: 'shapes', name: 'Shapes' };
      expect(await db.upsertProject(project)).to.equal(project);
      const updated = await db.upsertProject({ shortname: 'shapes', name: 'Shapes 2' });
      expect(updated).to.deep.equal({ n: 1, nModified: 1, ok: 1 });
      expect((await db.queryProject({ shortname: 'shapes' })).name).to.equal('Shapes 2');
      const removed = await db.deleteProject({ shortname: 'shapes' });
      expect(removed.deletedCount).to.equal(1);
      expect(await db.queryProject({ shortname: 'shapes' })).to.be.a('undefined');
    });

    it('annotations: insert returns the documents, update {multi} updates them all', async () => {
      expect(await db.insertAnnotations([])).to.deep.equal([]);
      const docs = [
        { fileID: 'f&slice=1', project: 'p', user: 'u', annotation: { uid: 1 } },
        { fileID: 'f&slice=1', project: 'p', user: 'u', annotation: { uid: 2 } }
      ];
      const inserted = await db.insertAnnotations(docs);
      expect(inserted).to.equal(docs);
      expect(inserted.every((d) => d._id instanceof mongodb.ObjectId)).to.equal(true);
      expect(await db.findAnnotations({ fileID: 'f&slice=1', project: 'p' })).to.have.length(2);

      const res = await db.updateAnnotations({
        query: { fileID: 'f&slice=1', project: 'p', backup: { $exists: false } },
        update: { $set: { backup: true } },
        options: { multi: true }
      });
      expect(res).to.deep.equal({ n: 2, nModified: 2, ok: 1 });
      expect(await db.findAnnotations({ fileID: 'f&slice=1', project: 'p' })).to.deep.equal([]);
      expect(await db.findAnnotations({ fileID: 'f&slice=1', project: 'p' }, true)).to.have.length(2);
    });

    it('tokens: addToken returns the token, findToken the document or null', async () => {
      const token = { token: 'tok-123', username: 'castme', expiryDate: new Date(Date.now() + 3600e3) };
      expect(await db.addToken(token)).to.equal(token);
      expect((await db.findToken('tok-123')).username).to.equal('castme');
      expect(await db.findToken('no-such-token')).to.equal(null);
    });
  });

  // describe('testing adding, and querying annotations',()=>{

  //     it('should add annotations fine',(done)=>{
  //         db.updateAnnotation(dummyAnnotation)
  //             .then(()=>done())
  //             .catch(done)
  //     })

  //     it('should query the added annotation fine',(done)=>{
  //         const { fileID } = dummyAnnotation
  //         db.findAnnotations({
  //             fileID
  //         })
  //             .then(annotations=>{
  //                 annotations.forEach(anno=>{
  //                     const { user, fileID, Hash, annotation } = anno
  //                     expect(expectedSavedDummy).to.deep.include.members([{ user, fileID, Hash, annotation }])
  //                 })
  //                 done()
  //             })
  //             .catch(done)

  //     })

  //     it('should add another annotations fine',(done)=>{
  //         db.updateAnnotation(dummyAnnotation2)
  //             .then(()=>done())
  //             .catch(done)
  //     })

  //     it('should query the added annotation fine',(done)=>{
  //         const { fileID } = dummyAnnotation2
  //         db.findAnnotations({
  //             fileID
  //         })
  //             .then(annotations=>{
  //                 annotations.forEach(anno=>{
  //                     const { user, fileID, Hash, annotation } = anno
  //                     expect(expectedSavedDummy2).to.deep.include.members([{ user, fileID, Hash, annotation }])
  //                 })
  //                 done()
  //             })
  //             .catch(done)

  //     })


  //     it('should update fine',(done)=>{
  //         db.updateAnnotation(dummyAnnotation_updated)
  //             .then(()=>done())
  //             .catch(done)
  //     })

  //     it('should fetch the updated annotation',(done)=>{

  //         const { fileID } = dummyAnnotation_updated
  //         db.findAnnotations({
  //             fileID
  //         })
  //             .then(annotations=>{
  //                 annotations.forEach(anno=>{
  //                     const { user, fileID, Hash, annotation } = anno
  //                     expect(expectedSavedDummyUpdated).to.deep.include.members([{ user, fileID, Hash, annotation }])
  //                 })
  //                 done()
  //             })
  //             .catch(done)
  //     })

  //     it('should fetch an empty array when no results could be found',(done)=>{
  //         db.findAnnotations({
  //             fileID: 'clearly a non-existent fileid'
  //         }).then(annotations=>{
  //             expect(annotations).to.be.deep.equal([])
  //             done()
  //         }).catch(done)
  //     })

  // });
});
