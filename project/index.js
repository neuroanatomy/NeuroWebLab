/**
 * Rules for saving project documents (NeuroWebLab 1.9.0) and validation
 * helpers (1.10.0). Each name is also exported from the root `index.js`.
 */
const {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete
} = require('./save');
const {
  plainText,
  sanitize,
  isBlank,
  text,
  listOf,
  isBlankRow,
  sortRows,
  shortnamePattern,
  droppedMessage
} = require('./rules');

module.exports = {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete,
  // 1.10.0: validation helpers (rules.js)
  plainText,
  sanitize,
  isBlank,
  text,
  listOf,
  isBlankRow,
  sortRows,
  shortnamePattern,
  droppedMessage
};
