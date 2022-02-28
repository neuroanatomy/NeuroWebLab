/**
 * Singleton configuration class to be injected in services
 */
module.exports = class Configuration {
  constructor() {
    if (Configuration._instance) {
      return Configuration._instance;
    }
    Configuration._instance = this;

    // default properties
    this.properties = {
      usernameField: 'username',
      usersCollection: 'users',
      projectsCollection: 'projects',
      annotationsCollection: 'annotations'
    };
  }

  static getInstance() {
    if(!Configuration._instance) {
      Configuration._instance = new Configuration();
    }

    return Configuration._instance;
  }

  setProperties(properties) {
    this.properties = properties;
  }

  get usernameField() {
    return this.properties.usernameField;
  }
  get usersCollection() {
    return this.properties.usersCollection;
  }
  get projectsCollection() {
    return this.properties.projectsCollection;
  }
  get annotationsCollection() {
    return this.properties.annotationsCollection;
  }
};
