const {getUserAccessLevel} = require('../helpers');
const Configuration = require('../../Configuration');

/**
 * @param {object} project A project
 * @returns {boolean} Whether the project gives `anyone` an access entry
 */
const hasAnyoneEntry = (project) => {
  if (!project) {
    return false;
  }
  if (project.owner === 'anyone') {
    return true;
  }
  const list = project.collaborators && project.collaborators.list;
  if (!Array.isArray(list)) {
    return false;
  }
  const { usernameField } = Configuration.getInstance();

  return list.some((c) => c && (c[usernameField] === 'anyone' || c.userID === 'anyone'));
};

module.exports = class HasPublicAccess {

  /**
   * @param {"collaborators" | "annotations" | "files"} type The access type
   * @param {AccessLevel} requestedAccessLevel An AccessLevel instance
   */
  constructor(type, requestedAccessLevel) {
    this.type = type;
    this.requestedAccessLevel = requestedAccessLevel;
  }

  isSatisfiedBy(project) {
    // no "anyone" entry: no public access (common, so not logged)
    if (!hasAnyoneEntry(project)) {
      return false;
    }
    try {
      return getUserAccessLevel(project, 'anyone', this.type)
        .isGreaterThanOrEqualTo(this.requestedAccessLevel);
    } catch (e) {
      console.error(e.message);

      return false;
    }
  }
};
