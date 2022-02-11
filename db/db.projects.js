/* eslint-disable max-lines */
/* eslint-disable max-statements */
/* eslint-disable prefer-promise-reject-errors */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

let db;
let projectsCollection;
let checkHealth;

/** projects: add project
 * @param {object} project A project object
 * @returns {object} The project that was added
*/
const addProject = (project) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  db.get(projectsCollection).insert(project)
    .then(() => resolve(project))
    .catch(reject);
});

/** projects: delete project
 * @param {object} projectQuery A project query
 * @returns {void}
*/
const deleteProject = (projectQuery) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  db.get(projectsCollection).remove(projectQuery)
    .then(resolve)
    .catch(reject);
});

/** projects: update project
 * @param {object} project A project object
 * @returns {object} The updated project
 */
const updateProject = (project) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  delete project._id;
  db.get(projectsCollection).update(
    { shortname: project.shortname },
    { $set: project }
  )
    .then((o) => {
      resolve(o);
    })
    .catch(reject);
});

/** projects: find project
 * @param {object} searchQuery A search object
 * @returns {object} The project found or empty
*/
const queryProject = (searchQuery) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  db.get(projectsCollection).findOne(searchQuery)
    .then((project) => {
      if(project) {
        resolve(project);
      } else {
        resolve();
      }
    })
    .catch(reject);
});

/** projects: upsert project
 * @param {object} project A project object
 * @returns {object} The resulting project or empty
*/
const upsertProject = (project) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  queryProject({
    shortname : project.shortname
  })
    .then((o) => {
      if(typeof o === 'undefined') {
        addProject(project)
          .then(resolve)
          .catch(reject);
      } else {
        updateProject(project)
          .then(resolve)
          .catch(reject);
      }
    })
    .catch(reject);
});

/** projects: query all projects
 * @param {object} pagination A pagination object
 * @returns {array} The projects found
*/
const queryAllProjects = (pagination) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  db.get(projectsCollection).find(pagination)
    .then((projects) => {
      if(projects) {
        resolve(projects);
      } else {
        reject({message: 'error find all projects', result: projects});
      }
    })
    .catch((e) => reject(e));
});

/** projects: query user projects
 * @param {string} requestedUser A username
 * @returns {array} Array with projects including the user as a collaborator
*/
const queryUserProjects = (requestedUser) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }

  /** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

  // const user = {username: requestedUser};
  const user = {};
  user[usernameField] = requestedUser;

  db.get(projectsCollection).find({
    $or: [
      {owner: requestedUser},
      {
        'collaborators.list': {
          $elemMatch: user}}
    ],
    backup: {$exists: false}
  })
  // @todo the results should be access filtered
    .then((projects) => {
      if(projects) {
        resolve(projects);
      } else {
        reject({message: 'error find all projects', result: projects});
      }
    })
    .catch(reject);
});

/** projects: search projects
 * @param {object} query A query object
 * @returns {array} List of projects matching the query
*/
const searchProjects = (query) => new Promise((resolve, reject) => {
  if(!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  db.get(projectsCollection)
    .find(
      {'shortname': { '$regex': query.q } },
      {fields: ['shortname', 'name'], limit: 10 }
    )
    .then(resolve)
    .catch(reject);
});

const init = ({
  db: newDb,
  usernameField: newUsernameField,
  usersCollection: newUsersCollection,
  projectsCollection: newProjectsCollection,
  checkHealth: newCheckHealth
}) => {
  db = newDb;
  usernameField = newUsernameField;
  usersCollection = newUsersCollection;
  projectsCollection = newProjectsCollection;
  checkHealth = newCheckHealth;
};

module.exports = {
  init,
  addProject,
  deleteProject,
  updateProject,
  queryProject,
  upsertProject,
  queryAllProjects,
  queryUserProjects,
  searchProjects
};
