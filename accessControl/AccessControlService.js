const _ = require('lodash');
const spec = require('./specifications');
const AccessType = require('./AccessType');
const AccessLevel = require('./AccessLevel');
const {getUserAccessLevel} = require('./helpers');

module.exports = class AccessControlService {
  static #hasAccess(accessType, requestedAccessLevel, project, userId) {

    const permissionsSpecs = [
      new spec.IsOwner(userId),
      new spec.HasPublicAccess(accessType, requestedAccessLevel),
      new spec.HasCustomAccess(userId, accessType, requestedAccessLevel)
    ];

    return permissionsSpecs.some((s) => s.isSatisfiedBy(project));
  }

  static hasAccess = _.curry(AccessControlService.#hasAccess);

  static hasFilesAccess = AccessControlService.hasAccess(AccessType.FILES);
  static hasAnnotationsAccess = AccessControlService.hasAccess(AccessType.ANNOTATIONS);
  static hasCollaboratorsAccess = AccessControlService.hasAccess(AccessType.COLLABORATORS);

  static canViewCollaborators = AccessControlService.hasCollaboratorsAccess(AccessLevel.VIEW);
  static canEditCollaborators = AccessControlService.hasCollaboratorsAccess(AccessLevel.EDIT);
  static canAddCollaborators = AccessControlService.hasCollaboratorsAccess(AccessLevel.ADD);
  static canRemoveCollaborators = AccessControlService.hasCollaboratorsAccess(AccessLevel.REMOVE);

  static canViewAnnotations = AccessControlService.hasAnnotationsAccess(AccessLevel.VIEW);
  static canEditAnnotations = AccessControlService.hasAnnotationsAccess(AccessLevel.EDIT);
  static canAddAnnotations = AccessControlService.hasAnnotationsAccess(AccessLevel.ADD);
  static canRemoveAnnotations = AccessControlService.hasAnnotationsAccess(AccessLevel.REMOVE);

  static canViewFiles = AccessControlService.hasFilesAccess(AccessLevel.VIEW);
  static canEditFiles = AccessControlService.hasFilesAccess(AccessLevel.EDIT);
  static canAddFiles = AccessControlService.hasFilesAccess(AccessLevel.ADD);
  static canRemoveFiles = AccessControlService.hasFilesAccess(AccessLevel.REMOVE);

  /**
   * Retrieve access level for given user or default to the publicly-defined access level
   *
   * @param {Object} project The project object
   * @param {String} userID User Identifier
   * @param {"collaborators" | "annotations" | "files"} accessType The access type of the
   * @returns {AccessLevel} The access level
   */
  static getUserOrPublicAccessLevel(project, userID, accessType) {
    try {
      return getUserAccessLevel(project, userID, accessType);
    } catch (e) {
      return getUserAccessLevel(project, 'anyone', accessType);
    }
  }

  /**
   * Whether a user is a logged-out visitor: no server-verified user. A
   * non-string, '', 'anonymous' (BrainBox's sentinel) or 'anyone'
   * (microdraw's sentinel); BrainBox's rule plus 'anyone' (1.14.0).
   * BrainBox's subclass defines its own `isLoggedOut` (without 'anyone'),
   * which hides this one for the subclass and its callers.
   * @param {*} user The username, or a logged-out sentinel
   * @returns {boolean} True for a logged-out visitor
   */
  static isLoggedOut(user) {
    return typeof user !== 'string' || user === '' || user === 'anonymous' || user === 'anyone';
  }

  /**
   * The access level a user has to a project (1.14.0, BrainBox's
   * `getUserOrPublicAccessLevel` override): the higher of the user's own level
   * (`getUserOrPublicAccessLevel`) and the `anyone` row's level, as `anyone` is
   * the minimum a named collaborator has (shared suite 4.2, decided
   * 2026-11-11); with no `anyone` row, the own level alone. For annotations, a
   * logged-out visitor (`isLoggedOut`) gets at most 'view': `anyone` with
   * annotations 'edit' (or more) means any logged-in user (shared suite 4.4,
   * 2026-11-11). The statics used are this class's, whatever subclass calls it.
   * @param {Object} project The project
   * @param {string|null} user The username, or a logged-out sentinel
   * @param {"collaborators" | "annotations" | "files"} accessType The access type
   * @throws {Error} As `getUserOrPublicAccessLevel`, when the project has
   * neither the user's row nor an `anyone` row for that type
   * @returns {AccessLevel} The access level
   */
  static getEffectiveAccessLevel(project, user, accessType) {
    let level = AccessControlService.getUserOrPublicAccessLevel(project, user, accessType);
    try {
      const publicLevel = AccessControlService.getUserOrPublicAccessLevel(project, 'anyone', accessType);
      if (publicLevel.isGreaterThan(level)) {
        level = publicLevel;
      }
    } catch (err) {
      // no 'anyone' row: the own level alone
    }
    if (accessType === AccessType.ANNOTATIONS && AccessControlService.isLoggedOut(user) &&
      level.isGreaterThan(AccessLevel.VIEW)) {
      return AccessLevel.VIEW;
    }

    return level;
  }

  /**
   * Check if user can update a project given his rights and modify newProject accordingly.
   * @param {Object} newProject The project to check
   * @param {Object} oldProject The original project to check against
   * @param {String} userID The user identifier
   * @returns {Array<String>} Type of changes that were discarded ("collaborators" | "annotations" | "files")
   */
  static preventUnauthorizedUpdates(newProject, oldProject, userID) {
    const ignoredChanges = [];

    [AccessType.COLLABORATORS, AccessType.FILES, AccessType.ANNOTATIONS].forEach((type) => {
      const checkAccessType = AccessControlService.hasAccess(type);
      const canAdd = checkAccessType(AccessLevel.ADD);
      const canRemove = checkAccessType(AccessLevel.REMOVE);
      if (
        (newProject[type].list.length > oldProject[type].list.length && !canAdd(oldProject, userID)) ||
        (newProject[type].list.length < oldProject[type].list.length && !canRemove(oldProject, userID))
      ) {
        ignoredChanges.push(type);
        newProject[type].list = oldProject[type].list;
      }
    });

    return ignoredChanges;
  }


};
