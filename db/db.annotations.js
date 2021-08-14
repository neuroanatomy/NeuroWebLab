/* eslint-disable max-statements */

let db;
let annotationsCollection;
let checkHealth;

/** annotations: search
  * @param {object} searchQuery having fields: fileID : string, username:string
  * @param {boolean} backup Whether to search in the backups as well or not
  * @returns {object} to resolve as an array of annotations
  */
const findAnnotations = async (searchQuery, backup) => {
  if (!checkHealth()) {
    throw new Error('db connection not healthy');
  }

  // include backups
  let query;
  if(typeof backup === "undefined" || backup === false) {
    query = Object.assign({}, searchQuery, { backup: { $exists: false } });
  } else {
    query = Object.assign({}, searchQuery);
  }

  let annotations;
  try {
    annotations = await db.get(annotationsCollection).find(query);
  } catch(err) {
    throw new Error(err);
  }

  if(annotations) {
    return annotations;
  }

  return [];
};

/** annotations: Update annotation object: add new, replace existing, remove others
  * @param {object} query The selection criteria for the update.
  * @param {object} update The modifications to apply.
  * @param {object} options Object with options: {upsert: <boolean>, multi: <boolean>}
  * @returns {Promise} to resolve when saving is complete
  */
const updateAnnotations = async ({query, update, options}) => {
  if (!checkHealth()) {
    throw new Error('db connection not healthy');
  }

  const res = await db.get('annotations').update(query, update, options);

  return res;
};

const insertAnnotations = async (arr) => {
  if (!checkHealth()) {
    throw new Error('db connection not healthy');
  }

  const res = await db.get('annotations').insert(arr);

  return res;
};

const init = ({
  db: newDb,
  annotationsCollection: newAnnotationsCollection,
  checkHealth: newCheckHealth
}) => {
  db = newDb;
  annotationsCollection = newAnnotationsCollection;
  checkHealth = newCheckHealth;
};

module.exports = {
  init,
  findAnnotations,
  updateAnnotations,
  insertAnnotations
};
