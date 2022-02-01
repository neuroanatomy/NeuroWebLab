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


};
