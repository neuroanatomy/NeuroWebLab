const auth = require('./auth/auth');
const db = require('./db/db');
const accessControl = require('./accessControl');
const Configuration = require('./Configuration');
const util = require('./util');
const project = require('./project');
const admin = require('./admin');
const embed = require('./embed');
const { projectEmbedRoute, firstSource } = require('./routes/projectEmbed');
const { wantsJSON, wantsPage, displayPath, notFound, errorHandler } = require('./routes/notFound');
const { listLabelSets, labelSetsRoute } = require('./routes/labelSets');
const { usernameFromCookie } = require('./auth/sessionUser');
const { version: packageVersion } = require('./package.json');
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

const version = () => `v${packageVersion}`;

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
  // ObjectId of NeuroWebLab's driver: ids built with another bson major are refused
  ObjectId: db.ObjectId,
  authTokenMiddleware,
  init,
  getTokenEndPoint,
  version,
  ...accessControl,
  // 1.8.0: shared helpers (util/, auth/sessionUser.js)
  ...util,
  usernameFromCookie,
  // 1.9.0: save rights for project fields, incomplete files guard (project/);
  // 1.10.0: validation helpers (project/rules.js);
  // 1.14.0: visibleProject, isAnyoneRow, collaboratorKey (project/visible.js)
  ...project,
  // 1.11.0: admin access (admin/)
  ...admin,
  // 1.12.0: embed tickets (embed/) and the Embed Project route (routes/)
  ...embed,
  projectEmbedRoute,
  firstSource,
  // 1.13.0: the 404 catch-all and the error handler (routes/notFound.js)
  wantsJSON,
  wantsPage,
  displayPath,
  notFound,
  errorHandler,
  // 1.15.0: the label set listing (routes/labelSets.js)
  listLabelSets,
  labelSetsRoute
};
