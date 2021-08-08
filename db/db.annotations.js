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

/** annotations: Update annotation object, appending new regions, replacing existing ones
  * @param {Object} saveQuery having fields {id, username, project, annotationType, annotation}
  * @returns {Promise} to resolve when saving is complete
  */
const updateAnnotation = async ({id, username, project, annotationType, annotation}) => {
  if (!checkHealth()) {
    throw new Error('db connection not healthy');
  }

  console.log("updateAnnotation function is not implemented yet");
  console.log({id, username, project, annotationType, annotation});

  // get new annotations

  // get previous annotations

  // update previous annotations with new annotations,

  // mark previous version as backup

  // add new version
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
  updateAnnotation
};
