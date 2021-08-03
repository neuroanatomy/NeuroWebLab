const auth = require("./auth/auth");
const db = require('./db/db');

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */
let usernameField;
const checkAnyoneUser = () => {
  /* check that the 'anyone' user exists. Insert it if it doesn't */
  const query = {};
  query[usernameField] = 'anyone';
  // const query = {username: 'anyone'};
  console.log({fn: "checkAnyoneUser", query});

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

const version = () => {
  return "v0.0.1";
}

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */
const init = ({
  app,
  MONGO_DB,
  dirname,
  usernameField: newUsernameField,
  usersCollection,
  projectsCollection
}) => {
  usernameField = newUsernameField;

  console.log({MONGO_DB});

  db.init({
    MONGO_DB,
    overwriteMongoPath: null,
    callback: checkAnyoneUser,
    usernameField,
    usersCollection,
    projectsCollection
  });

  app.db = db;

  auth.init({app, MONGO_DB, dirname, usernameField});
};

module.exports = {
  version,
  init
};
