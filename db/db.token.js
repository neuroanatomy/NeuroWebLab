let db;

/** add token
 * @param {string} token A random token to add
 * @returns {void}
*/
const addToken = (token) => new Promise((resolve, reject) => {
  db.get('log').insert(token)
    .then(() => resolve(token))
    .catch((e) => reject(e));
});

/** find token
 * @param {string} token A random token to find
 * @returns {object} DB entry for that token, with creation and expiry date
*/
const findToken = (token) => new Promise((resolve, reject) => {
  db.get('log').findOne({token})
    .then((theToken) => resolve(theToken))
    .catch((e) => reject(e));
});

const init = ({ db: newDb }) => {
  db = newDb;
};

module.exports = {
  init,
  addToken,
  findToken
};
