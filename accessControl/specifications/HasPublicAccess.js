const {getUserAccessLevel} = require('../helpers');

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
    try {
      return getUserAccessLevel(project, 'anyone', this.type)
        .isGreaterThanOrEqualTo(this.requestedAccessLevel);
    } catch (e) {
      console.error(e);

      return false;
    }
  }
};
