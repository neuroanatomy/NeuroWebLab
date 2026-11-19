/**
 * Rules for saving project documents (NeuroWebLab 1.9.0), validation helpers
 * (1.10.0), what a visitor may see of a project (1.14.0), project versions
 * (1.16.0), the project lock (1.18.0) and the rights each list's changes
 * need (1.19.0), the version token (1.23.0). Each name is also exported from the
 * root `index.js`.
 */
const {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete,
  keepListsWithoutEditRights
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
const { CURRENT, NEWEST_FIRST, findCurrentProject, saveProjectVersion, projectVersion } = require('./versions');
const { withLock, isLocked, projectKey, withProjectLock } = require('./lock');
const { validateProject, projectRowProblems, duplicateLayerNames, parseProjectData } = require('./validate');

module.exports = {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete,
  // 1.19.0: the rights each list's changes need (save.js)
  keepListsWithoutEditRights,
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
  // 1.23.0: the version token of the admin fixes (versions.js)
  projectVersion,
  // 1.18.0: the project lock (lock.js)
  withLock,
  isLocked,
  projectKey,
  withProjectLock,
  // 1.20.0: the validation core (validate.js)
  validateProject,
  projectRowProblems,
  duplicateLayerNames,
  parseProjectData
};
