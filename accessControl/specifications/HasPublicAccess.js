const {getUserAccessLevel} = require('../helpers');

module.exports = class HasPublicAccess {
  constructor(type, requestedAccessLevel) {
    // AccessType
    this.type = type;
    // AccessLevel
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
