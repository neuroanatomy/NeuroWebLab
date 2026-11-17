const { expect } = require('chai');
const sinon = require('sinon');
const _ = require('lodash');
const Configuration = require('../Configuration');
const { visibleProject, isAnyoneRow, collaboratorKey } = require('./visible');

const access = (collaborators, annotations, files) => ({ collaborators, annotations, files });
const row = (username, a) => ({ username, userID: username, access: a });

const project = (rows, extra = {}) => ({
  shortname: 'visiblespec',
  owner: 'owner1',
  name: 'Visible spec',
  modifiedBy: 'member',
  collaborators: { list: rows, note: 'kept' },
  files: { list: [{ source: 'a.nii.gz' }, { source: 'b.nii.gz' }] },
  annotations: { list: [{ type: 'volume', name: 'labels' }] },
  ...extra
});

const anyoneRow = (a = access('none', 'none', 'view')) => row('anyone', a);

describe('project/visible', () => {
  let savedProperties;
  let consoleError;

  before(() => {
    savedProperties = Configuration.getInstance().properties;
    Configuration.getInstance().setProperties({
      usernameField: 'username',
      usersCollection: 'users',
      projectsCollection: 'projects',
      annotationsCollection: 'annotations'
    });
  });

  after(() => {
    Configuration.getInstance().setProperties(savedProperties);
  });

  // HasCustomAccess logs a visitor without a row
  beforeEach(() => {
    consoleError = sinon.stub(console, 'error');
  });

  afterEach(() => {
    consoleError.restore();
  });

  describe('visibleProject', () => {
    const names = (p) => p.collaborators.list.map(collaboratorKey);

    it('the owner sees everything', () => {
      const p = project([anyoneRow(), row('member', access('view', 'view', 'view'))]);
      const v = visibleProject(p, 'owner1');
      expect(names(v)).to.deep.equal(['anyone', 'member']);
      expect(v.files.list).to.have.length(2);
      expect(v.annotations.list).to.have.length(1);
      expect(v.modifiedBy).to.equal('member');
      expect(v.collaborators.note).to.equal('kept');
    });

    it('a collaborator, for each combination of collaborators and annotations view', () => {
      for (const [collaborators, annotations] of [['view', 'view'], ['view', 'none'], ['none', 'view'], ['none', 'none']]) {
        const p = project([anyoneRow(), row('member', access(collaborators, annotations, 'view'))]);
        const v = visibleProject(p, 'member');
        const label = `collaborators ${collaborators}, annotations ${annotations}`;
        expect(names(v), label).to.deep.equal(collaborators === 'view' ? ['anyone', 'member'] : ['anyone']);
        expect(v.annotations.list, label).to.have.length(annotations === 'view' ? 1 : 0);
        expect('modifiedBy' in v, label).to.equal(collaborators === 'view');
        expect(v.files.list, label).to.have.length(2);
      }
    });

    it('a visitor who may view the annotations but not the collaborators (microdraw, 2026-11-09)', () => {
      // anyone may view neither: deciding after hiding the collaborators would judge member as anyone
      const p = project([anyoneRow(access('none', 'none', 'view')), row('member', access('none', 'view', 'view'))]);
      const v = visibleProject(p, 'member');
      expect(names(v)).to.deep.equal(['anyone']);
      expect(v.annotations.list).to.have.length(1);
    });

    it('a user with no row of their own gets the anyone row\'s rights', () => {
      const p = project([anyoneRow(access('view', 'view', 'view')), row('member', access('view', 'view', 'view'))]);
      const v = visibleProject(p, 'stranger');
      expect(names(v)).to.deep.equal(['anyone', 'member']);
      expect(v.annotations.list).to.have.length(1);
      const closed = visibleProject(project([anyoneRow(), row('member', access('view', 'view', 'view'))]), 'stranger');
      expect(names(closed)).to.deep.equal(['anyone']);
      expect(closed.annotations.list).to.deep.equal([]);
    });

    it('a logged-out visitor (\'anyone\', \'anonymous\', null) gets the anyone row\'s rights', () => {
      for (const user of ['anyone', 'anonymous', null]) {
        const p = project([anyoneRow(), row('member', access('view', 'view', 'view'))]);
        const v = visibleProject(p, user);
        expect(names(v), String(user)).to.deep.equal(['anyone']);
        expect(v.annotations.list, String(user)).to.deep.equal([]);
        expect(v.files.list, String(user)).to.have.length(2);
        expect('modifiedBy' in v, String(user)).to.equal(false);
      }
      const open = project([anyoneRow(access('view', 'view', 'view')), row('member', access('view', 'view', 'view'))]);
      for (const user of ['anyone', 'anonymous', null]) {
        const v = visibleProject(open, user);
        expect(names(v), String(user)).to.deep.equal(['anyone', 'member']);
        expect(v.modifiedBy, String(user)).to.equal('member');
      }
    });

    it('the anyone row is kept by username only, and by userID only', () => {
      const byUsername = { username: 'anyone', access: access('none', 'none', 'view') };
      const byUserID = { userID: 'anyone', nickname: 'anyone', access: access('none', 'none', 'view') };
      const member = row('member', access('view', 'view', 'view'));
      expect(visibleProject(project([byUsername, member]), 'stranger').collaborators.list).to.deep.equal([byUsername]);
      // a row with userID only: NWL's access check reads userID
      expect(visibleProject(project([byUserID, member]), 'stranger').collaborators.list).to.deep.equal([byUserID]);
    });

    it('non-object rows are dropped with the collaborators', () => {
      const p = project([anyoneRow(), 'anyone', null, row('member', access('view', 'view', 'view'))]);
      expect(visibleProject(p, 'stranger').collaborators.list).to.deep.equal([anyoneRow()]);
    });

    it('the files are hidden when not viewable (BrainBox)', () => {
      const p = project([anyoneRow(access('view', 'view', 'none')), row('member', access('view', 'view', 'view'))]);
      const v = visibleProject(p, 'stranger');
      expect(v.files.list).to.deep.equal([]);
      expect(v.annotations.list).to.have.length(1);
      expect(visibleProject(p, 'member').files.list).to.have.length(2);
    });

    it('missing or malformed lists become empty lists, keeping the list object\'s fields', () => {
      const p = {
        shortname: 'malformed',
        owner: 'owner1',
        files: { list: 'not a list', note: 'kept' },
        annotations: ['not an object']
      };
      const v = visibleProject(p, 'owner1');
      expect(v.collaborators).to.deep.equal({ list: [] });
      expect(v.files).to.deep.equal({ note: 'kept', list: [] });
      expect(v.annotations).to.deep.equal({ list: [] });
      const w = visibleProject(p, 'stranger');
      expect(w.collaborators).to.deep.equal({ list: [] });
      expect(w.files).to.deep.equal({ note: 'kept', list: [] });
    });

    it('the project is not changed, and the returned lists are new', () => {
      for (const user of ['owner1', 'member', 'stranger', null]) {
        const p = project([anyoneRow(), row('member', access('view', 'none', 'view'))]);
        const before = _.cloneDeep(p);
        const v = visibleProject(p, user);
        expect(p, String(user)).to.deep.equal(before);
        expect(v, String(user)).to.not.equal(p);
        for (const type of ['collaborators', 'files', 'annotations']) {
          expect(v[type], `${user} ${type}`).to.not.equal(p[type]);
          expect(v[type].list, `${user} ${type}`).to.not.equal(p[type].list);
        }
      }
      const malformed = { owner: 'owner1', files: 'x' };
      visibleProject(malformed, 'stranger');
      expect(malformed).to.deep.equal({ owner: 'owner1', files: 'x' });
    });
  });

  describe('isAnyoneRow', () => {
    it('a plain object whose username or userID is anyone', () => {
      expect(isAnyoneRow({ username: 'anyone' })).to.equal(true);
      expect(isAnyoneRow({ userID: 'anyone' })).to.equal(true);
      expect(isAnyoneRow({ nickname: 'anyone' })).to.equal(false);
      expect(isAnyoneRow({ username: 'someone' })).to.equal(false);
      expect(isAnyoneRow('anyone')).to.equal(false);
      expect(isAnyoneRow(null)).to.equal(false);
    });
  });

  describe('collaboratorKey', () => {
    it('each key alone', () => {
      expect(collaboratorKey({ userID: 'a' })).to.equal('a');
      expect(collaboratorKey({ nickname: 'b' })).to.equal('b');
      expect(collaboratorKey({ username: 'c' })).to.equal('c');
    });

    it('BrainBox\'s order when the keys differ: userID, nickname, username', () => {
      expect(collaboratorKey({ username: 'c', nickname: 'b', userID: 'a' })).to.equal('a');
      expect(collaboratorKey({ username: 'c', nickname: 'b' })).to.equal('b');
      expect(collaboratorKey({ username: 'c', userID: 'a' })).to.equal('a');
    });

    it('empty strings and non-strings are skipped', () => {
      expect(collaboratorKey({ userID: '', nickname: '', username: 'c' })).to.equal('c');
      expect(collaboratorKey({ userID: 3, username: 'c' })).to.equal('c');
      expect(typeof collaboratorKey({ userID: '' })).to.equal('undefined');
      expect(typeof collaboratorKey({})).to.equal('undefined');
    });

    it('undefined for a non-object', () => {
      for (const v of ['anyone', null, {}.missing, 3, ['anyone']]) {
        expect(typeof collaboratorKey(v)).to.equal('undefined');
      }
    });
  });
});
