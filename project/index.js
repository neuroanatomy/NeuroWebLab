/**
 * Rules for saving project documents (NeuroWebLab 1.9.0). Each name is also
 * exported from the root `index.js`.
 */
const {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete
} = require('./save');

module.exports = {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete
};
