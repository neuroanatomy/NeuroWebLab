const {getUserAccessLevel} = require('../helpers');

module.exports = class HasCustomAccess {
  constructor(userID, type, requestedAccessLevel) {
    // user identifier
    this.userID = userID;
    // AccessType
    this.type = type;
    // AccessLevel
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
