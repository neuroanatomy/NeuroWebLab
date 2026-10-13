/* eslint-disable prefer-promise-reject-errors */
const { escapeRegex } = require('./escapeRegex');

let db;
let usernameField;
let usersCollection;
let checkHealth;

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */
/** add user
 * @param {object} user User to add
 * @returns {object} The user that was added
*/
const addUser = (user) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  db.get(usersCollection).insert(user)
    .then(() => resolve(user))
    .catch((e) => reject(e));
});

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

const updateUser = (user) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }

  // const query = {username: user.username}
  const query = {};
  query[usernameField] = user.username || user[usernameField];

  delete user._id;

  db.get(usersCollection).update(query, {
    $set: user
  })
    .then(() => resolve(user))
    .catch(reject);
});

/** find user
 * @param {object} searchQuery A query object
 * @returns {object} A user object
*/
const queryUser = (searchQuery) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }

  db.get(usersCollection).findOne(searchQuery)
    .then((user) => {
      if(user) {
        resolve(user);
      } else {
        reject({
          message: 'error find one user',
          result: user
        });
      }
    })
    .catch(reject);
});

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */
/** upsert user
 * @param {object} user User object
 * @returns {void}
*/
const upsertUser = (user) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }

  // const query = {username: user.username}
  const query = {};
  query[usernameField] = user.username || user[usernameField];

  delete user._id;

  queryUser(query)
    .then(() => updateUser(user))
    .then(resolve)
    .catch((e) => {
      if(e.message === 'error find one user') {
        addUser(user)
          .then(resolve)
          .catch(reject);
      } else {
        reject(e);
      }
    });
});

/** users: query all users
 * @param {object} query MongoDB query (default: all users)
 * @param {object} options monk find options, e.g. {skip, limit, fields}
 * @returns {array} List of users
*/
const queryAllUsers = (query = {}, options = {}) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  db.get(usersCollection).find(query, options)
    .then((users) => {
      if(users) {
        resolve(users);
      } else {
        reject({message: 'error find all users', result: users});
      }
    })
    .catch((e) => reject(e));
});

/** users: search users whose name contains a text
 * @param {object} query A query object, {q: text}. The text is matched
 *   literally (regex characters are escaped).
 * @returns {array} List of users matching the query (at most 10)
*/
const searchUsers = (query) => new Promise((resolve, reject) => {
  if(!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }

  /** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

  if (!query || typeof query.q !== 'string') {
    return reject(new Error('searchUsers: q must be a string'));
  }

  const user = {};
  user[usernameField] = {'$regex': escapeRegex(query.q)};

  // const fields = ['username', 'name']
  const fields = [usernameField, 'name'];

  db.get(usersCollection)
    .find(user, {fields, limit: 10})
    .then(resolve)
    .catch(reject);
});

const init = ({
  db: newDb,
  usernameField: newUsernameField,
  usersCollection: newUsersCollection,
  checkHealth: newCheckHealth
}) => {
  db = newDb;
  usernameField = newUsernameField;
  usersCollection = newUsersCollection;
  checkHealth = newCheckHealth;
};

module.exports = {
  addUser,
  updateUser,
  queryUser,
  upsertUser,
  queryAllUsers,
  searchUsers,
  init
};
