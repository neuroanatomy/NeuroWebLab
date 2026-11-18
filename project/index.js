/**
 * Rules for saving project documents (NeuroWebLab 1.9.0), validation helpers
 * (1.10.0), what a visitor may see of a project (1.14.0), project versions
 * (1.16.0) and the project lock (1.18.0). Each name is also exported from the
 * root `index.js`.
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
const { visibleProject, isAnyoneRow, collaboratorKey } = require('./visible');
const { CURRENT, NEWEST_FIRST, findCurrentProject, saveProjectVersion } = require('./versions');
const { withLock, isLocked, projectKey, withProjectLock } = require('./lock');

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
  droppedMessage,
  // 1.14.0: what a visitor may see of a project (visible.js)
  visibleProject,
  isAnyoneRow,
  collaboratorKey,
  // 1.16.0: project versions (versions.js)
  CURRENT,
  NEWEST_FIRST,
  findCurrentProject,
  saveProjectVersion,
  // 1.18.0: the project lock (lock.js)
  withLock,
  isLocked,
  projectKey,
  withProjectLock
};
