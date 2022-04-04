const auth = require('./auth/auth');
const db = require('./db/db');
const accessControl = require('./accessControl');
const Configuration = require('./Configuration');
const { authTokenMiddleware, getTokenEndPoint } = require('./auth/token');

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */
let usernameField;
const checkAnyoneUser = () => {

  /* check that the 'anyone' user exists. Insert it if it doesn't */
  const query = {};
  query[usernameField] = 'anyone';
  // const query = {username: 'anyone'};
  console.log({ fn: 'checkAnyoneUser', query });

  db.queryUser(query)
    .then((res) => {
      console.log('"anyone" user correctly configured.', res);
    })
    .catch((err) => {
      console.log('"anyone" user absent: adding one.', err);
      const anyone = {
        // username: 'anyone',
        name: 'Any User',
        joined: (new Date()).toJSON()
      };
      anyone[usernameField] = 'anyone';
      db.addUser(anyone);
    });
};

const version = () => 'v0.0.1';

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

const init = async ({
  app,
  MONGO_DB,
  dirname,
  usernameField: newUsernameField,
  usersCollection,
  projectsCollection,
  annotationsCollection
}) => {
  usernameField = newUsernameField;

  console.log({ MONGO_DB });

  Configuration.getInstance().setProperties({
    usernameField,
    usersCollection,
    projectsCollection,
    annotationsCollection
  });

  await db.init({
    MONGO_DB,
    overwriteMongoPath: null,
    callback: checkAnyoneUser,
    usernameField,
    usersCollection,
    projectsCollection,
    annotationsCollection
  });
  app.db = db;
  auth.init({ app, db, dirname, usernameField });
};

module.exports = {
  authTokenMiddleware,
  init,
  getTokenEndPoint,
  version,
  ...accessControl
};
