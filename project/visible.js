/**
 * What a visitor may see of a project, and who a collaborator row names
 * (NeuroWebLab 1.14.0, stage 4 merge M7). The apps' code: microdraw
 * app/controller/project/visibleProject.js (`visibleProjectParts`) and
 * project.validation.js (`isAnyone`, `collaboratorName`); BrainBox
 * controller/project/project.controller.js (`projectForUser`, and the
 * settings page's inline filter) and project-rows.js (`collaboratorUser`).
 * Where the two differ, it says which app's version it is.
 */
const _ = require('lodash');
const AccessControlService = require('../accessControl/AccessControlService');

const LIST_TYPES = ['collaborators', 'files', 'annotations'];

const isNonEmptyString = (v) => typeof v === 'string' && v !== '';

/**
 * Whether a collaborator row is the `anyone` row: a plain object whose
 * `username` or `userID` is 'anyone' (microdraw's `isAnyone`; BrainBox
 * checked `userID` only)
 * @param {*} row A collaborator row
 * @returns {boolean} True for the `anyone` row
 */
const isAnyoneRow = (row) => _.isPlainObject(row) && (row.username === 'anyone' || row.userID === 'anyone');

/**
 * The user a collaborator row names: for a plain object, the first non-empty
 * string among `userID`, `nickname` and `username`, in BrainBox's order
 * (`collaboratorUser`); `undefined` for anything else (microdraw's
 * `collaboratorName`) or for a row that names nobody.
 *
 * How it differs from each app:
 * - BrainBox's `collaboratorUser` returns a non-object row as it is (here:
 *   `undefined`), and takes the first truthy value, string or not (here: a
 *   non-empty string only).
 * - microdraw's `collaboratorName` reads `username` first, then `userID`, and
 *   never `nickname` (BrainBox's rows carry `nickname`). microdraw refuses rows
 *   whose `username` and `userID` differ, so the order only matters for
 *   BrainBox's stored rows.
 * @param {*} row A collaborator row
 * @returns {string|undefined} The user's name
 */
const collaboratorKey = (row) => {
  if (!_.isPlainObject(row)) {
    return;
  }
  for (const key of ['userID', 'nickname', 'username']) {
    if (isNonEmptyString(row[key])) {
      return row[key];
    }
  }
};

/**
 * A project as a visitor may see it. A new object is returned and `project`
 * is never changed (microdraw's version changed it in place; BrainBox's
 * returned a shallow copy): the lists are new arrays in new list objects, and
 * the other fields are copied shallowly, as in BrainBox.
 *
 * - A missing or malformed `collaborators`, `files` or `annotations` list
 *   object becomes `{...whatever object was there, list: []}` (microdraw;
 *   BrainBox threw without `collaborators`).
 * - Both permissions are decided on the unchanged project, before anything is
 *   hidden: hiding the collaborators first removed the visitor's own row, so a
 *   collaborator who may view the annotations but not the collaborators was
 *   judged as `anyone` (microdraw, 2026-11-09).
 * - Collaborators the visitor can't view: only the `anyone` row is kept
 *   (`isAnyoneRow`, by `username` or `userID`), and `modifiedBy` is deleted.
 * - Annotations the visitor can't view: the list is emptied.
 * - Files the visitor can't view: the list is emptied (BrainBox). microdraw's
 *   callers already refuse a visitor who can't view the files, so this changes
 *   nothing for microdraw.
 *
 * Permissions go through `AccessControlService` (`canViewCollaborators`,
 * `canViewAnnotations`, `canViewFiles`), as both apps do.
 * @param {object} project The project document (not changed)
 * @param {string|null} user The visitor's username, or the app's logged-out
 * sentinel ('anyone', 'anonymous' or null)
 * @returns {object} The project as the visitor may see it
 */
const visibleProject = (project, user) => {
  const visible = { ...project };
  for (const type of LIST_TYPES) {
    const value = project[type];
    const listObject = _.isPlainObject(value) ? value : {};
    visible[type] = { ...listObject, list: Array.isArray(listObject.list) ? [...listObject.list] : [] };
  }
  // decided on the unchanged lists (the copies hold the same rows)
  const show = {
    collaborators: AccessControlService.canViewCollaborators(visible, user),
    annotations: AccessControlService.canViewAnnotations(visible, user),
    files: AccessControlService.canViewFiles(visible, user)
  };
  if (!show.collaborators) {
    visible.collaborators.list = visible.collaborators.list.filter(isAnyoneRow);
    // who saved last may be a collaborator
    delete visible.modifiedBy;
  }
  if (!show.annotations) {
    visible.annotations.list = [];
  }
  if (!show.files) {
    visible.files.list = [];
  }

  return visible;
};

module.exports = {
  visibleProject,
  isAnyoneRow,
  collaboratorKey
};
