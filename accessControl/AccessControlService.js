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
  static canRemoveFiles = AccessControlService.hasAnnotationsAccess(AccessLevel.REMOVE);

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
