const AccessLevel = require('../AccessLevel');
const _ = require('lodash');

module.exports = {

  /**
     * Returns the access level of a user given a project and an access type
     *
     * @param {Object} project Project object
     * @param {String} userID User ID
     * @param {"collaborators" | "annotations" | "files"} accessType Access type
     * @throws {Error}
     * @returns {AccessLevel} An AccessLevel instance
     */
  getUserAccessLevel(project, userID, accessType) {
    if (project.owner === userID) {
      return AccessLevel.REMOVE;
    }
    if (_.isEmpty(project.collaborators.list)) {
      throw new Error('Project has an empty collaborators list');
    }
    const user = project.collaborators.list.find((c) => c.userID === userID);
    if (_.isNil(user)) {
      throw new Error(`Collaborator ${userID} not found`);
    }
    const level = user.access[accessType];
    if (_.isNil(level)) {
      throw new Error(`Access level not found for type "${accessType}" and user "${userID}"`);
    }

    return new AccessLevel(level);
  }

};
