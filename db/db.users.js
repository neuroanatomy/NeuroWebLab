/* eslint-disable prefer-promise-reject-errors */
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
    .then(() => updateUser({...user, disabled: false}))
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
 * @param {object} pagination Pagination object
 * @returns {array} List of users
*/
const queryAllUsers = (pagination) => new Promise((resolve, reject) => {
  if (!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }
  db.get('users').find(pagination)
    .then((users) => {
      if(users) {
        resolve(users);
      } else {
        reject({message: 'error find all users', result: users});
      }
    })
    .catch((e) => reject(e));
});

/** users: search users
 * @param {object} query A query object
 * @returns {array} List of users matching the query
*/
const searchUsers = (query) => new Promise((resolve, reject) => {
  if(!checkHealth()) {
    return reject(new Error('db connection not healthy'));
  }

  /** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

  // const user = {username: {"$regex": query.q}};
  const user = {};
  user[usernameField] = {'$regex': query.q};

  // const fields = ['username', 'name']
  const fields = [usernameField, 'name'];

  db.get('users')
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
