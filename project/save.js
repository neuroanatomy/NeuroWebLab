/**
 * Save rights for an existing project's own fields, and the incomplete files
 * list guard (NeuroWebLab 1.9.0, stage 4 merge M2), and the rights each
 * list's changes need (1.19.0, M12). The apps' code: the
 * same in microdraw and BrainBox since 2026-11-15, but where it says which
 * app's version it is.
 */
const _ = require('lodash');
const AccessType = require('../accessControl/AccessType');
const AccessLevel = require('../accessControl/AccessLevel');
const AccessControlService = require('../accessControl/AccessControlService');
const { listOf } = require('./rules');

const LIST_TYPES = [AccessType.FILES, AccessType.ANNOTATIONS, AccessType.COLLABORATORS];

const SAVE_REFUSAL = 'You may not change this project: saving it needs edit rights on its files, annotations or collaborators';


/**
 * Whether a user may save an existing project (2026-11-15): `edit` on at
 * least one of its lists. What each list's changes need is then checked list
 * by list, and the project's own fields need `files: edit`
 * (keepFieldsWithoutFilesEdit). Both apps' code.
 * @param {object} oldProject The stored project
 * @param {string} loggedUser The user saving
 * @returns {boolean} true if the save may go on
 */
const canSaveProject = (oldProject, loggedUser) => LIST_TYPES.some((type) => AccessControlService.hasAccess(type, AccessLevel.EDIT, oldProject, loggedUser));

/**
 * The answer to a save that canSaveProject refuses, to send with status 403.
 * The reason is in `error`, which the settings page shows (nwl-components
 * ProjectInfo.vue), and in `message`, for the clients that read it. Both
 * apps' body and text.
 * @returns {{success: boolean, error: string, message: string}} A new object each time
 */
const saveRefusal = () => ({ success: false, error: SAVE_REFUSAL, message: SAVE_REFUSAL });

/**
 * The text added to a save's success message for the changes ignored for
 * lack of rights (both apps' text, with its leading space).
 * @param {Array<string>} ignored The lists and fields whose changes were ignored
 * @returns {string} ' Some changes (on a, b) were ignored due to a lack of permissions.', or '' if none
 */
const ignoredChangesMessage = (ignored) => {
  const names = Array.isArray(ignored) ? _.uniq(ignored) : [];

  return names.length > 0 ? ` Some changes (on ${names.join(', ')}) were ignored due to a lack of permissions.` : '';
};

// the fields that are neither the lists nor the project's own fields: set by the server (owner,
// modified, modifiedBy, _id, backup), checked against the URL (shortname), or never stored
// (filesLoaded)
const notOwnFields = [...LIST_TYPES, 'owner', 'shortname', '_id', 'backup', 'modified', 'modifiedBy', 'filesLoaded'];

// a field sent empty ('' for a name the settings page fills in) is the same as one the stored
// project lacks
const isEmptyField = (v) => _.isNil(v) || v === '';

/**
 * Keep the stored value of each of the project's own fields (name,
 * description, url, created and any other field that is not one of the three
 * lists) if the user may not edit the files (2026-11-15). A field the stored
 * project lacks is removed. BrainBox's version: a field equal to the stored
 * value once sanitised, as the body was, is unchanged too; without
 * `sanitize` it is microdraw's.
 * @param {object} newProject The project to save (changed in place)
 * @param {object} oldProject The stored project
 * @param {string} loggedUser The user saving
 * @param {object} [options] Options
 * @param {function(*): *} [options.sanitize] The app's sanitiser of the body, applied to a stored value to compare it with the one sent
 * @returns {Array<string>} The fields whose changes were ignored
 */
const keepFieldsWithoutFilesEdit = (newProject, oldProject, loggedUser, { sanitize } = {}) => {
  if (AccessControlService.hasFilesAccess(AccessLevel.EDIT, oldProject, loggedUser)) {
    return [];
  }
  const sameField = (value, stored) => _.isEqual(value, stored) ||
    (typeof sanitize === 'function' && _.isEqual(value, sanitize(stored))) ||
    (isEmptyField(value) && isEmptyField(stored));
  const changed = Object.keys(newProject)
    .filter((key) => !notOwnFields.includes(key) && !sameField(newProject[key], oldProject[key]));
  for (const key of changed) {
    if (_.has(oldProject, key)) {
      newProject[key] = oldProject[key];
    } else {
      delete newProject[key];
    }
  }

  return changed;
};

// the lists in the order both apps check them, and name them in the message
const LIST_ORDER = [AccessType.COLLABORATORS, AccessType.FILES, AccessType.ANNOTATIONS];

// what a row of a list is compared on: the caller's rowKey[type], else the whole row
const rowKeyOf = (rowKey, type) => {
  if (!_.isPlainObject(rowKey) || !_.has(rowKey, type)) {
    return _.identity;
  }
  const key = rowKey[type];
  if (typeof key !== 'function') {
    throw new TypeError(`keepListsWithoutEditRights: options.rowKey.${type} must be a function`);
  }

  return key;
};

/**
 * Keep the stored version of each list (collaborators, files, annotations)
 * whose change the user's rights on it don't allow (2026-11-11, shared suite
 * 2.3, 2.4, 2.26; NeuroWebLab 1.19.0, stage 4 merge M12). Checked list by
 * list, against the stored project and the user's rights on it
 * (`AccessControlService.hasAccess`):
 * - a longer list needs `add`;
 * - a shorter one needs `remove`;
 * - a list that differs in any other way (a row changed in place, or moved)
 *   needs `edit`. The levels are ordered, so `add` and `remove` imply `edit`.
 *
 * "Differs": the rows sent, mapped by `rowKey[type]`, are not deep equal
 * (lodash `isEqual`), in order, to the comparison rows mapped the same way:
 * `oldRows[type]` if given (BrainBox: the stored rows sanitised as the body,
 * as given to sortRows), else the stored rows. A list put back is always the
 * stored one, `listOf(oldProject, type)`, never `oldRows`.
 *
 * `newProject` is changed in place, as keepFieldsWithoutFilesEdit and
 * preventUnauthorizedUpdates do. Both apps' validation refuses a document
 * without the three lists before this is called (microdraw checkProject: each
 * a plain object with an array `list`; BrainBox isProjectObject: collaborators
 * and annotations, and an existing project's files, sent or the stored ones),
 * so `newProject[type].list` is not checked here. A stored project without a
 * list has `[]`. A new project (no `oldProject`) is the caller's: both apps
 * skip the call.
 *
 * The rule of both apps' code: microdraw preventUnauthorizedUpdates and its
 * own keepListsWithoutEditRights (comparableEntry), BrainBox postProject's
 * loop (project-rows.js rowKey, listChanged).
 * @param {object} newProject The project to save (changed in place)
 * @param {object} oldProject The stored project
 * @param {string} loggedUser The user saving
 * @param {object} [options] Options
 * @param {object} [options.rowKey] What a row is compared on, by list: a function of the row; a list without one compares whole rows
 * @param {object} [options.oldRows] The rows to compare with, by list, instead of the stored ones
 * @returns {Array<string>} The lists whose changes were ignored, each once, in the order collaborators, files, annotations
 */
const keepListsWithoutEditRights = (newProject, oldProject, loggedUser, { rowKey, oldRows } = {}) => LIST_ORDER.filter((type) => {
  const storedRows = listOf(oldProject, type);
  const rows = newProject[type].list;
  const comparedRows = (oldRows && Array.isArray(oldRows[type])) ? oldRows[type] : storedRows;
  const key = rowKeyOf(rowKey, type);
  const may = (level) => AccessControlService.hasAccess(type, level, oldProject, loggedUser);
  const refused = (rows.length > storedRows.length && !may(AccessLevel.ADD)) ||
    (rows.length < storedRows.length && !may(AccessLevel.REMOVE)) ||
    (!_.isEqual(rows.map((r) => key(r)), comparedRows.map((r) => key(r))) && !may(AccessLevel.EDIT));
  if (refused) {
    newProject[type].list = storedRows;
  }

  return refused;
});

/**
 * Whether the files list sent is incomplete: the settings page loads the
 * files in batches and sends how many it received (`filesLoaded.count`); if
 * that is not the stored list's length, the list it sends lacks files. A
 * project sent without `filesLoaded` (API clients, the new-project page) is
 * taken as complete; a stored project without a files list has 0 files; no
 * stored project, nothing to keep. microdraw's version.
 *
 * It changes nothing in `newProject` or `oldProject`: the caller puts the
 * stored list back and deletes `filesLoaded`. If `dropped` (the blank rows
 * the validation left out, by list) is given and the list is incomplete, it
 * sets `dropped.files = 0`: no files row was dropped, the list sent was not
 * used (as microdraw's caller does).
 * @param {object} newProject The project sent
 * @param {object} oldProject The stored project
 * @param {object} [dropped] The validation's dropped rows, by list
 * @returns {boolean} true if the stored list must be kept
 */
const filesListIncomplete = (newProject, oldProject, dropped) => {
  const incomplete = !_.isNil(oldProject) && _.isPlainObject(newProject) && typeof newProject.filesLoaded !== 'undefined' &&
    !(_.isPlainObject(newProject.filesLoaded) && newProject.filesLoaded.count === listOf(oldProject, 'files').length);
  if (incomplete && _.isPlainObject(dropped)) {
    dropped.files = 0;
  }

  return incomplete;
};

module.exports = {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete,
  keepListsWithoutEditRights
};
