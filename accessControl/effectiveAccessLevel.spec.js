const { expect } = require('chai');
const Configuration = require('../Configuration');
const { AccessControlService, AccessType } = require('./index');

const level = (p, user, type = AccessType.ANNOTATIONS) => AccessControlService.getEffectiveAccessLevel(p, user, type).toString();

describe('AccessControlService.getEffectiveAccessLevel and isLoggedOut (1.14.0)', () => {
  let savedProperties;

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

  // Ported from BrainBox test/unit/anyone-floor.spec.js (shared suite 4.2,
  // decided 2026-11-11): 'anyone' is the minimum a named collaborator has
  describe('anyone is the minimum a named collaborator has (BrainBox anyone-floor.spec.js)', () => {
    const row = (name, collaborators, annotations, files) => ({ userID: name, nickname: name, access: { collaborators, annotations, files } });
    const project = (rows) => ({
      shortname: 'anyonefloorspec',
      owner: 'foo',
      collaborators: { list: rows },
      files: { list: [] },
      annotations: { list: [] }
    });

    // anyone-floor.spec.js, 1st case
    it('a member whose row is below anyone gets anyone\'s level, for every access type', () => {
      const p = project([row('anyone', 'view', 'edit', 'view'), row('low', 'none', 'none', 'none')]);
      expect(level(p, 'low', AccessType.ANNOTATIONS)).to.equal('edit');
      expect(level(p, 'low', AccessType.FILES)).to.equal('view');
      expect(level(p, 'low', AccessType.COLLABORATORS)).to.equal('view');
    });

    // anyone-floor.spec.js, 2nd case
    it('a member whose row is above anyone keeps their row; a member without anyone row keeps theirs', () => {
      const p = project([row('anyone', 'view', 'view', 'view'), row('high', 'edit', 'remove', 'add')]);
      expect(level(p, 'high', AccessType.ANNOTATIONS)).to.equal('remove');
      expect(level(p, 'high', AccessType.FILES)).to.equal('add');
      const noAnyone = project([row('member', 'view', 'edit', 'view')]);
      expect(level(noAnyone, 'member', AccessType.ANNOTATIONS)).to.equal('edit');
    });

    // anyone-floor.spec.js, 3rd case
    it('a logged-out visitor is still capped at view on annotations', () => {
      const p = project([row('anyone', 'view', 'edit', 'view'), row('low', 'none', 'none', 'none')]);
      expect(level(p, 'anonymous', AccessType.ANNOTATIONS)).to.equal('view');
    });
  });

  // Ported from BrainBox test/unit/logged-out-annotations.spec.js (shared
  // suite 4.4, 2026-11-11): the level cases, not
  // setVolumeAnnotationsAccessByProjects (BrainBox's own)
  describe('a logged-out visitor never writes annotations (BrainBox logged-out-annotations.spec.js)', () => {
    const anyone = (annotations) => ({ userID: 'anyone', nickname: 'anyone', access: { collaborators: 'view', annotations, files: 'view' } });
    const project = (annotations, shortname = 'loggedoutspec') => ({
      shortname,
      owner: 'foo',
      collaborators: { list: [anyone(annotations), { userID: 'editor', nickname: 'editor', access: { collaborators: 'view', annotations: 'edit', files: 'view' } }] },
      files: { list: [] },
      annotations: { list: [] }
    });

    // logged-out-annotations.spec.js, 1st case
    it('anyone: edit (or more) gives a logged-out visitor view, and a logged-in user edit', () => {
      for (const annotations of ['edit', 'add', 'remove']) {
        const p = project(annotations);
        expect([null, '', 'anonymous'].map((user) => level(p, user))).to.deep.equal(['view', 'view', 'view']);
        expect(level(p, 'bar')).to.equal(annotations);
      }
    });

    // logged-out-annotations.spec.js, 2nd case
    it('reads and the other access types are unchanged', () => {
      expect(level(project('view'), 'anonymous')).to.equal('view');
      expect(level(project('none'), 'anonymous')).to.equal('none');
      const p = project('edit');
      p.collaborators.list[0].access.files = 'edit';
      expect(level(p, 'anonymous', AccessType.FILES)).to.equal('edit');
    });
  });

  describe('added in NeuroWebLab', () => {
    const row = (username, collaborators, annotations, files) => ({ username, access: { collaborators, annotations, files } });
    const project = (rows) => ({ shortname: 'effectivespec', owner: 'foo', collaborators: { list: rows } });

    it('no anyone row: the own level alone, and the owner\'s', () => {
      const p = project([row('member', 'none', 'add', 'view')]);
      expect(level(p, 'member')).to.equal('add');
      expect(level(p, 'member', AccessType.COLLABORATORS)).to.equal('none');
      expect(level(p, 'foo')).to.equal('remove');
    });

    it('neither row: it throws, as getUserOrPublicAccessLevel', () => {
      const p = project([row('member', 'view', 'view', 'view')]);
      expect(() => level(p, 'stranger')).to.throw(/not found/);
      expect(() => AccessControlService.getUserOrPublicAccessLevel(p, 'stranger', AccessType.ANNOTATIONS)).to.throw(/not found/);
      expect(() => level(project([]), 'stranger')).to.throw();
    });

    it('a user without a row of their own gets anyone\'s level', () => {
      const p = project([row('anyone', 'view', 'add', 'edit'), row('member', 'none', 'none', 'none')]);
      expect(level(p, 'stranger')).to.equal('add');
      expect(level(p, 'stranger', AccessType.FILES)).to.equal('edit');
    });

    it('the cap applies only to annotations', () => {
      const p = project([row('anyone', 'remove', 'remove', 'remove')]);
      for (const user of [null, '', 'anonymous', 'anyone']) {
        expect(level(p, user, AccessType.ANNOTATIONS), String(user)).to.equal('view');
        expect(level(p, user, AccessType.FILES), String(user)).to.equal('remove');
        expect(level(p, user, AccessType.COLLABORATORS), String(user)).to.equal('remove');
      }
    });

    it('\'anyone\' as the visitor is capped too (microdraw\'s sentinel)', () => {
      const p = project([row('anyone', 'view', 'edit', 'view')]);
      expect(level(p, 'anyone')).to.equal('view');
      expect(level(p, 'logged-in')).to.equal('edit');
    });

    it('a level below view is not raised by the cap', () => {
      const p = project([row('anyone', 'view', 'none', 'view')]);
      expect(level(p, 'anyone')).to.equal('none');
    });

    it('getUserOrPublicAccessLevel is unchanged: the own row first, no floor, no cap', () => {
      const p = project([row('anyone', 'view', 'edit', 'view'), row('low', 'none', 'none', 'none')]);
      expect(AccessControlService.getUserOrPublicAccessLevel(p, 'low', AccessType.ANNOTATIONS).toString()).to.equal('none');
      expect(AccessControlService.getUserOrPublicAccessLevel(p, 'anyone', AccessType.ANNOTATIONS).toString()).to.equal('edit');
    });
  });

  describe('isLoggedOut', () => {
    it('each sentinel is logged out', () => {
      for (const user of [null, {}.missing, '', 'anonymous', 'anyone', 3, {}]) {
        expect(AccessControlService.isLoggedOut(user), String(user)).to.equal(true);
      }
    });

    it('a username is not', () => {
      for (const user of ['bar', 'Anyone', 'anonymous1']) {
        expect(AccessControlService.isLoggedOut(user), user).to.equal(false);
      }
    });

    it('a subclass that defines its own isLoggedOut keeps it (BrainBox\'s)', () => {
      class Sub extends AccessControlService {
        static isLoggedOut(user) {
          return typeof user !== 'string' || user === '' || user === 'anonymous';
        }
      }
      expect(Sub.isLoggedOut('anyone')).to.equal(false);
      expect(AccessControlService.isLoggedOut('anyone')).to.equal(true);
      // getEffectiveAccessLevel uses this class's statics, whatever subclass calls it
      const p = { owner: 'foo', collaborators: { list: [{ username: 'anyone', access: { annotations: 'edit' } }] } };
      expect(Sub.getEffectiveAccessLevel(p, 'anyone', AccessType.ANNOTATIONS).toString()).to.equal('view');
    });
  });
});
