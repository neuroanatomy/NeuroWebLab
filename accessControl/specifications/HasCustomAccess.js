const {getUserAccessLevel} = require('../helpers');

module.exports = class HasCustomAccess {

  /**
   * @param {String} userID User Identifier
   * @param {"collaborators" | "annotations" | "files"} type The access type
   * @param {AccessLevel} requestedAccessLevel An AccessLevel instance
   */
  constructor(userID, type, requestedAccessLevel) {
    this.userID = userID;
    this.type = type;
    this.requestedAccessLevel = requestedAccessLevel;
  }

  isSatisfiedBy(project) {
    try {
      return getUserAccessLevel(project, this.userID, this.type)
        .isGreaterThanOrEqualTo(this.requestedAccessLevel);
    } catch(e) {
      console.error(e.message);

      return false;
    }
  }
};
