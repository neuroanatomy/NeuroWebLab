/**
 * Save rights for an existing project's own fields, and the incomplete files
 * list guard (NeuroWebLab 1.9.0, stage 4 merge M2). The apps' code: the
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
  filesListIncomplete
};
