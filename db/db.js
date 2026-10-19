const { MongoClient, ObjectId } = require('mongodb');
const { toMongoUri } = require('./native');
const dbToken = require('./db.token.js');
const dbUsers = require('./db.users.js');
const dbProjects = require('./db.projects.js');
const dbAnnotations = require('./db.annotations.js');

let client = null;
let nativeDb = null;
let mongoUri = null;
let connected = false;
let monkDb = null;
let monkWarned = false;

/**
 * Returns the native MongoDB Db (mongodb ~6.21) of NeuroWebLab's client.
 * This is the database accessor apps should use.
 * @returns {object} The native MongoDB Db object
 */
const nativeMongoDB = () => nativeDb;

/**
 * @returns {object} NeuroWebLab's native MongoClient (used by the session store)
 */
const mongoClient = () => client;

/**
 * Deprecated: a monk instance on the same database, for apps that still call
 * `db.get(...)`. It is created on the first call, with its own connection pool
 * (monk's bundled mongodb 3.7 driver); an app that never calls it opens no monk
 * connection. Removed in 1.0.0: use nativeMongoDB().
 * @returns {object} A monk instance (undefined before init)
 */
const mongoDB = () => {
  if (!monkWarned) {
    monkWarned = true;
    process.emitWarning(
      'NeuroWebLab db.mongoDB() (monk) is deprecated and will be removed in 1.0.0; use db.nativeMongoDB()',
      'DeprecationWarning',
      'NWL_MONK'
    );
  }
  if (!monkDb && mongoUri) {
    // required here, so that apps that don't call mongoDB() don't load monk
    // eslint-disable-next-line global-require
    const monk = require('monk');
    monkDb = monk(mongoUri);
  }

  return monkDb;
};

const version = () => {
  console.log('db v0.0.1');
};

/**
 * @returns {boolean} true while the client is connected to a server
 */
const checkHealth = () => connected;

// the client is healthy while at least one server is known to be up
const watchHealth = (newClient) => {
  newClient.on('topologyDescriptionChanged', ({ newDescription }) => {
    if (newClient === client) {
      connected = [...newDescription.servers.values()].some((server) => server.type !== 'Unknown');
    }
  });
  newClient.on('topologyClosed', () => {
    if (newClient === client) {
      connected = false;
    }
  });
};

/**
 * Close the native client, and the monk instance of mongoDB() if it was opened.
 * @returns {Promise<void>} Resolves when closed
 */
const close = async () => {
  const oldClient = client;
  const oldMonk = monkDb;
  monkDb = null;
  client = null;
  nativeDb = null;
  connected = false;
  if (oldMonk) {
    await oldMonk.close();
  }
  if (oldClient) {
    await oldClient.close();
  }
};

const initHelpers = ({usernameField, usersCollection, projectsCollection, annotationsCollection}) => {
  dbToken.init({db: nativeDb});
  dbUsers.init({db: nativeDb, usernameField, usersCollection, projectsCollection, checkHealth});
  dbProjects.init({db: nativeDb, usernameField, projectsCollection, checkHealth});
  dbAnnotations.init({db: nativeDb, annotationsCollection, checkHealth});
};

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

const init = async ({
  MONGO_DB,
  overwriteMongoPath,
  callback,
  usernameField,
  usersCollection,
  projectsCollection,
  annotationsCollection
}) => {

  console.log(`connecting to mongodb at: ${overwriteMongoPath || MONGO_DB}`);

  try {
    mongoUri = toMongoUri(overwriteMongoPath || MONGO_DB);
    client = new MongoClient(mongoUri);
    watchHealth(client);
    await client.connect();
    nativeDb = client.db();
    connected = true;

    console.log('connected successfully');

    initHelpers({usernameField, usersCollection, projectsCollection, annotationsCollection});

    if (typeof callback !== 'undefined') {
      return callback();
    }
  } catch (e) {
    // retry (?)
    connected = false;
    console.log('connection error', e);
  }
};

module.exports = {
  version,
  init,
  close,
  mongoDB,
  nativeMongoDB,
  mongoClient,
  checkHealth,
  ObjectId,
  addToken: dbToken.addToken,
  findToken: dbToken.findToken,
  addUser: dbUsers.addUser,
  queryUser: dbUsers.queryUser,
  queryAllUsers: dbUsers.queryAllUsers,
  updateUser: dbUsers.updateUser,
  upsertUser: dbUsers.upsertUser,
  searchUsers: dbUsers.searchUsers,
  addProject: dbProjects.addProject,
  deleteProject: dbProjects.deleteProject,
  updateProject: dbProjects.updateProject,
  queryProject: dbProjects.queryProject,
  upsertProject: dbProjects.upsertProject,
  queryAllProjects: dbProjects.queryAllProjects,
  queryUserProjects: dbProjects.queryUserProjects,
  searchProjects: dbProjects.searchProjects,
  findAnnotations: dbAnnotations.findAnnotations,
  updateAnnotations: dbAnnotations.updateAnnotations,
  insertAnnotations: dbAnnotations.insertAnnotations
};
