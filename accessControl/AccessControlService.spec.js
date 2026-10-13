const { expect } = require('chai');
const sinon = require('sinon');
const Configuration = require('../Configuration');
const { AccessControlService, AccessLevel, AccessType } = require('./index');
const { HasPublicAccess } = require('./specifications');

const project = (list, owner = 'owner1') => ({
  shortname: 'p',
  owner,
  collaborators: { list }
});

const collaborator = (username, access) => ({ username, access });

describe('AccessControlService', () => {
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

  describe('canRemoveFiles checks the files access, not the annotations access', () => {
    const p = project([
      collaborator('anyone', { collaborators: 'none', annotations: 'none', files: 'none' }),
      collaborator('filesRemover', { collaborators: 'view', annotations: 'view', files: 'remove' }),
      collaborator('annotationsRemover', { collaborators: 'view', annotations: 'remove', files: 'view' })
    ]);

    it('files: remove, annotations: view -> can remove files', () => {
      expect(AccessControlService.canRemoveFiles(p, 'filesRemover')).to.equal(true);
      expect(AccessControlService.canRemoveAnnotations(p, 'filesRemover')).to.equal(false);
    });

    it('files: view, annotations: remove -> cannot remove files', () => {
      expect(AccessControlService.canRemoveFiles(p, 'annotationsRemover')).to.equal(false);
      expect(AccessControlService.canRemoveAnnotations(p, 'annotationsRemover')).to.equal(true);
    });

    it('the owner can remove files', () => {
      expect(AccessControlService.canRemoveFiles(p, 'owner1')).to.equal(true);
    });

    it('the other files checks are unchanged', () => {
      expect(AccessControlService.canViewFiles(p, 'annotationsRemover')).to.equal(true);
      expect(AccessControlService.canEditFiles(p, 'annotationsRemover')).to.equal(false);
      expect(AccessControlService.canAddFiles(p, 'filesRemover')).to.equal(true);
    });
  });

  describe('HasPublicAccess', () => {
    let consoleError;

    beforeEach(() => {
      consoleError = sinon.stub(console, 'error');
    });

    afterEach(() => {
      consoleError.restore();
    });

    const publicView = new HasPublicAccess(AccessType.FILES, AccessLevel.VIEW);

    it('a project without an "anyone" entry gives no public access, and logs nothing', () => {
      const p = project([collaborator('someone', { collaborators: 'view', annotations: 'view', files: 'view' })]);
      expect(publicView.isSatisfiedBy(p)).to.equal(false);
      expect(AccessControlService.canViewFiles(p, 'stranger')).to.equal(false);
      expect(consoleError.calledWithMatch(sinon.match.instanceOf(Error))).to.equal(false);
      expect(consoleError.calledWithMatch(/anyone/)).to.equal(false);
    });

    it('an empty collaborators list or none at all gives no public access, and logs nothing', () => {
      expect(publicView.isSatisfiedBy(project([]))).to.equal(false);
      expect(publicView.isSatisfiedBy({ shortname: 'p', owner: 'o' })).to.equal(false);
      expect(publicView.isSatisfiedBy(null)).to.equal(false);
      expect(consoleError.called).to.equal(false);
    });

    it('an "anyone" entry gives its access level to everybody', () => {
      const p = project([collaborator('anyone', { collaborators: 'view', annotations: 'edit', files: 'view' })]);
      expect(publicView.isSatisfiedBy(p)).to.equal(true);
      expect(new HasPublicAccess(AccessType.FILES, AccessLevel.EDIT).isSatisfiedBy(p)).to.equal(false);
      expect(AccessControlService.canEditAnnotations(p, 'stranger')).to.equal(true);
    });

    it('"anyone" found by userID too (nwl-components settings page)', () => {
      const p = project([{ userID: 'anyone', access: { collaborators: 'none', annotations: 'none', files: 'view' } }]);
      expect(publicView.isSatisfiedBy(p)).to.equal(true);
    });

    it('a malformed "anyone" entry: no access, and only the message is logged (no stack)', () => {
      const p = project([{ username: 'anyone', access: {} }]);
      expect(publicView.isSatisfiedBy(p)).to.equal(false);
      expect(consoleError.calledOnce).to.equal(true);
      const [arg] = consoleError.firstCall.args;
      expect(arg).to.be.a('string');
      expect(arg).to.match(/Access level not found/);
    });
  });
});
