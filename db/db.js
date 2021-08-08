const monk = require('monk');
const dbToken = require('./db.token.js');
const dbUsers = require('./db.users.js');
const dbProjects = require('./db.projects.js');
const dbAnnotations = require('./db.annotations.js');

let db;
let connected = false;

const mongoDB = () => db;

const version = () => {
  console.log("db v0.0.1");
};

/**
 * @returns {boolean} checks mongodb connection
 */
const checkHealth = () => connected;

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

const init = ({
  MONGO_DB,
  overwriteMongoPath,
  callback,
  usernameField,
  usersCollection,
  projectsCollection,
  annotationsCollection
}) => {

  /* variables used for compatibility */
  dbToken.init({db});
  dbUsers.init({db, usernameField, usersCollection, projectsCollection, checkHealth});
  dbProjects.init({db, projectsCollection, checkHealth});
  dbAnnotations.init({db, annotationsCollection, checkHealth});

  console.log(`connecting to mongodb at: ${overwriteMongoPath || MONGO_DB}`);
  db = monk(overwriteMongoPath || MONGO_DB);

  db.then(() => {
    connected = true;

    console.log('connected successfully');

    if(typeof callback !== 'undefined') {
      return callback();
    }
  })
    .catch((e) => {
      // retry (?)
      connected = false;
      console.log('connection error', e);
    });
};

module.exports = {
  version,
  init,
  mongoDB,
  checkHealth,
  addToken: dbToken.addToken,
  findToken: dbToken.findToken,
  addUser: dbUsers.addUser,
  queryUser: dbUsers.queryUser,
  updateUser: dbUsers.updateUser,
  upsertUser: dbUsers.upsertUser
};
