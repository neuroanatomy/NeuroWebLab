/* eslint-disable max-lines -- the core's steps and their JSDoc, one module */
/**
 * The project validation core (NeuroWebLab 1.20.0, stage 4 merge M13, decision
 * D2 option A): the checks of a project document sent to
 * POST /project/json/:projectName that both apps share, with the text and file
 * rules left to each app through `rules`. The apps' code: microdraw
 * app/controller/project/project.validation.js (checkProject, structureError,
 * rowProblemList: the reference for the order and the texts), BrainBox
 * controller/project/project.controller.js (isProjectObject) and
 * project-rows.js.
 *
 * What stays the app's:
 * - merging the stored top-level fields into the body (BrainBox before the
 *   validation, microdraw after);
 * - writing both collaborator keys (microdraw's withBothKeys);
 * - the rights (403), checked before the validation;
 * - the 400 answer, with `error`;
 * - sending a rejection (a failing `findMissingUsers` or rule) to its error handler.
 */
const _ = require('lodash');
const AccessLevel = require('../accessControl/AccessLevel');
const { isBlankRow: defaultIsBlankRow, listOf, sanitize, shortnamePattern, sortRows } = require('./rules');

const LIST_TYPES = ['files', 'collaborators', 'annotations'];
// the fields the client may not set: the database id, and the backup flag (a project with
// `backup` is hidden from every read)
const SERVER_FIELDS = ['_id', 'backup'];
// the project's own fields that must be strings when present (microdraw's)
const OWN_FIELDS = ['name', 'description', 'url'];
const ROW_HOOKS = ['collaboratorUser', 'fileError', 'layerError'];
const PROJECT_HOOKS = [...ROW_HOOKS, 'fieldsError', 'projectError'];

const isNonEmptyString = (str) => typeof str === 'string' && str.trim() !== '';

/**
 * The project sent in the body: a JSON string or a plain object (microdraw's
 * parseProjectData)
 * @param {*} data req.body.data
 * @returns {object|undefined} The project, or undefined if it is not an object
 */
const parseProjectData = (data) => {
  let project = data;
  if (typeof data === 'string') {
    try {
      project = JSON.parse(data);
    } catch (err) {
      return;
    }
  }
  if (_.isPlainObject(project)) {
    return project;
  }
};

// a clear error for an app that does not give a hook (a programming error, not a bad document)
const checkRules = (rules, hooks, caller) => {
  if (!_.isPlainObject(rules)) {
    throw new TypeError(`${caller}: rules must be a plain object`);
  }
  for (const name of hooks) {
    if (typeof rules[name] !== 'function') {
      throw new TypeError(`${caller}: rules.${name} must be a function`);
    }
  }
  for (const name of ['rowKey', 'isBlankRow']) {
    if (typeof rules[name] !== 'undefined' && !_.isPlainObject(rules[name])) {
      throw new TypeError(`${caller}: rules.${name} must be a plain object of functions, by list`);
    }
  }
};

// the app's rowKey and isBlankRow, each list defaulting to the whole row and NWL's isBlankRow
const sortOptions = (rules) => ({
  rowKey: _.fromPairs(LIST_TYPES.map((type) => [type, (rules.rowKey && rules.rowKey[type]) || _.identity])),
  isBlankRow: _.fromPairs(LIST_TYPES.map((type) => [type, (rules.isBlankRow && rules.isBlankRow[type]) || defaultIsBlankRow[type]]))
});

// Whether a row has a username and a userID that differ (microdraw's)
const hasDifferentKeys = (c) => _.isPlainObject(c) && isNonEmptyString(c.username) &&
  isNonEmptyString(c.userID) && c.username !== c.userID;

const differentKeysError = (c, i) => `Collaborator ${i + 1} has a different username (${c.username}) and userID (${c.userID}): they must be equal`;

// an `anyone` row: its user, as the app reads it, is 'anyone'
const isAnyoneRow = (c, rules) => _.isPlainObject(c) && rules.collaboratorUser(c) === 'anyone';

/**
 * What is wrong with a collaborator row, checked as new: microdraw's
 * collaboratorError, with the app's reading of the row's user
 * @param {*} c The row
 * @param {number} i Its index
 * @param {object} rules The app's rules (collaboratorUser)
 * @returns {string|null} What is wrong, or null
 */
const collaboratorError = (c, i, rules) => {
  if (!_.isPlainObject(c)) {
    return `Collaborator ${i + 1} must be an object`;
  }
  const user = rules.collaboratorUser(c);
  if (!isNonEmptyString(user)) {
    return `Collaborator ${i + 1} needs a username`;
  }
  if (hasDifferentKeys(c)) {
    return differentKeysError(c, i);
  }
  if (!_.isPlainObject(c.access) || !LIST_TYPES.every((type) => AccessLevel.values.includes(c.access[type]))) {
    return `Collaborator ${user} has invalid access values (allowed: ${AccessLevel.values.join(', ')})`;
  }

  return null;
};

/*
 * The per-row checks of step 7, by list, shared by validateProject and
 * projectRowProblems so that the two never disagree
 */
const rowChecks = (rules) => ({
  files: (f, i) => rules.fileError(f, i) || null,
  collaborators: (c, i) => collaboratorError(c, i, rules),
  annotations: (a, i) => rules.layerError(a, i) || null
});

// What two layer names are compared on: case and surrounding spaces ignored
const nameKey = (name) => String(name).trim()
  .toLowerCase();

const hasName = (a) => _.isPlainObject(a) && isNonEmptyString(a.name);

/**
 * The annotation layers named as another layer of the list, compared on their
 * `name` trimmed and lowercased (microdraw's duplicateLayerNames, BrainBox's
 * rule). A row is reported if a row before it, or a row in `stored` anywhere,
 * has the same name; rows in `stored` are never reported, so duplicates
 * already stored stay accepted unchanged (shared suite 2.10, 2.14).
 * @param {Array} list The annotation layers
 * @param {Set<number>} [stored] Indexes of the stored rows
 * @returns {Array<object>} [{ row, message }]
 */
const duplicateLayerNames = (list, stored = new Set()) => {
  const problems = [];
  list.forEach((a, i) => {
    if (stored.has(i) || !hasName(a)) {
      return;
    }
    const same = list.findIndex((b, k) => k !== i && (k < i || stored.has(k)) && hasName(b) && nameKey(b.name) === nameKey(a.name));
    if (same >= 0) {
      problems.push({ row: i, message: `Annotation ${i + 1} has the same name as annotation ${same + 1}: "${a.name.trim()}" (names are compared ignoring case)` });
    }
  });

  return problems;
};

// The first error among the rows of a list, skipping the stored ones
const firstError = (list, check, skip) => {
  for (let i = 0; i < list.length; i += 1) {
    const error = skip.has(i) ? null : check(list[i], i);
    if (error) {
      return error;
    }
  }

  return null;
};

/*
 * Step 3: sort the rows of each list against the stored ones, sanitised as the
 * body (the lists sent lose their blank new rows)
 */
const sortLists = (project, oldProject, rules) => {
  const options = sortOptions(rules);
  const stored = {};
  const dropped = {};
  for (const type of LIST_TYPES) {
    stored[type] = new Set();
    if (_.isPlainObject(project[type]) && Array.isArray(project[type].list)) {
      ({ kept: project[type].list, stored: stored[type], dropped: dropped[type] } = sortRows(type, project[type].list, sanitize(listOf(oldProject, type)), options));
    }
  }

  return { stored, dropped };
};

// Steps 4 and 5: the shortname, then the three lists
const shapeError = (project, shortname, isNew) => {
  if (project.shortname !== shortname) {
    return 'The project shortname in the data differs from the one in the URL';
  }
  if (isNew && !shortnamePattern.test(shortname)) {
    return 'The project shortname can only contain letters, numbers and hyphens';
  }
  for (const type of LIST_TYPES) {
    if (!_.isPlainObject(project[type]) || !Array.isArray(project[type].list)) {
      return `The project needs a ${type} list`;
    }
  }

  return null;
};

// Step 6, the core's part: name, description and url are strings when present. With
// `rules.checkStoredFields: false`, a value equal to the stored one sanitised is not checked
const ownFieldsError = (project, oldProject, rules) => {
  const isStoredValue = (field) => rules.checkStoredFields === false && !_.isNil(oldProject) &&
    _.isEqual(project[field], sanitize(oldProject[field]));
  for (const field of OWN_FIELDS) {
    if (typeof project[field] !== 'undefined' && typeof project[field] !== 'string' && !isStoredValue(field)) {
      return `The project ${field} must be a string`;
    }
  }

  return null;
};

// Steps 7 to 10: the rows not stored, the duplicate names, the anyone row, both keys on stored rows
const rowsError = (project, stored, rules) => {
  const checks = rowChecks(rules);
  const error = firstError(project.files.list, checks.files, stored.files) ||
    firstError(project.collaborators.list, checks.collaborators, stored.collaborators) ||
    firstError(project.annotations.list, checks.annotations, stored.annotations);
  if (error) {
    return error;
  }
  const [duplicate] = duplicateLayerNames(project.annotations.list, stored.annotations);
  if (duplicate) {
    return duplicate.message;
  }
  if (!project.collaborators.list.some((c) => isAnyoneRow(c, rules))) {
    return 'The collaborators list needs an \'anyone\' entry';
  }
  // stored rows too (microdraw: a save writes both keys on every row, and cannot choose
  // between two names), unless `rules.checkStoredKeys` is false
  if (rules.checkStoredKeys !== false) {
    const different = project.collaborators.list.findIndex(hasDifferentKeys);
    if (different >= 0) {
      return differentKeysError(project.collaborators.list[different], different);
    }
  }

  return null;
};

/**
 * Step 13: the users that must exist, each once: a new project's owner, and the
 * users of the collaborator rows that are not stored, not `anyone`, and not in
 * the stored project (a stored project may name users removed since: saving
 * it again stays possible). microdraw's and BrainBox's usersToCheck.
 * @param {object} project The project sent
 * @param {object|null} oldProject The stored project
 * @param {string} owner The owner
 * @param {Set<number>} stored The indexes of the stored collaborator rows
 * @param {object} rules The app's rules (collaboratorUser)
 * @returns {Array<string>} The names
 */
const usersToCheck = (project, oldProject, owner, stored, rules) => {
  const known = listOf(oldProject, 'collaborators').filter(_.isPlainObject)
    .map((c) => rules.collaboratorUser(c));
  const names = project.collaborators.list
    .filter((c, i) => !stored.has(i) && !isAnyoneRow(c, rules))
    .map((c) => rules.collaboratorUser(c))
    .filter((name) => !known.includes(name));

  return _.uniq(_.isNil(oldProject) ? [owner, ...names] : names);
};

/**
 * Parse, sanitise and validate a project document sent to
 * POST /project/json/:projectName. The steps, in this order (microdraw's):
 * 1. parse: a JSON string or a plain object, else 'Invalid project data';
 * 2. sanitise every string (`sanitize`), drop `_id` and `backup`;
 * 3. sort each list's rows against the stored ones (`sortRows`, with
 *    `rules.rowKey` and `rules.isBlankRow`; the stored rows sanitised): the
 *    stored rows are accepted as they are, the blank new ones dropped;
 * 4. the shortname: the body's is the URL's; a new one matches `shortnamePattern`;
 * 5. the three lists are required ('The project needs a <type> list');
 * 6. `name`, `description` and `url` are strings when present, then
 *    `rules.fieldsError(project, { oldProject, isNew })`;
 * 7. the rows not stored: files (`rules.fileError(file, i)`), collaborators
 *    (a plain object, a user by `rules.collaboratorUser`, `username` and
 *    `userID` equal when both are set, access values of `AccessLevel.values`),
 *    layers (`rules.layerError(layer, i)`); the first error is answered;
 * 8. duplicate layer names (duplicateLayerNames), stored rows never reported;
 * 9. an `anyone` row is required;
 * 10. a different `username` and `userID` on a stored row is refused too,
 *    unless `rules.checkStoredKeys` is false;
 * 11. `await rules.projectError(project, { oldProject, isNew, stored })`;
 * 12. `project.owner = owner` ('The project has no owner' if it is blank);
 * 13. the users (usersToCheck): `await findMissingUsers(names)`, any missing
 *     gives 'Unknown users: a, b'.
 * Stored rows are never checked by steps 7 to 9 and 13 (shared suite 2.14),
 * and step 10 is the only check of a stored row.
 *
 * It never throws for a bad document: it answers `{ error }`. It rejects only
 * if `findMissingUsers` or a rule does, or with a `TypeError` naming a hook
 * `rules` lacks (a programming error). The per-row checks are the ones
 * projectRowProblems uses, so the two never disagree.
 *
 * `rules` (a plain object):
 * - `collaboratorUser(row)`: the user a row names (microdraw `username`, else
 *   `userID`; BrainBox `userID`, `nickname` or `username`); called with plain objects only;
 * - `fileError(file, i)`, `layerError(layer, i)`: a text, or null; called with any
 *   value of the list, a non-object included;
 * - `fieldsError(project, { oldProject, isNew })`, may be async: a text, or null;
 * - `projectError(project, { oldProject, isNew, stored })`, may be async: a text, or null;
 * - `rowKey` (default: the whole row) and `isBlankRow` (default: NWL's), by list;
 * - `checkStoredFields` (default true; false: a field of step 6 equal to the
 *   stored value sanitised is accepted, BrainBox's "stored value kept");
 * - `checkStoredKeys` (default true; false: step 10 is skipped, stored rows
 *   stay accepted as they are).
 * @param {*} data req.body.data
 * @param {object} options Options
 * @param {string} options.shortname The URL's shortname
 * @param {object|null} [options.oldProject] The stored project, or null for a new one
 * @param {string} options.owner The owner to set: the stored one, or the creator (never the client's)
 * @param {function(Array<string>): Promise<Array<string>>} options.findMissingUsers The names with no user document
 * @param {object} options.rules The app's rules
 * @returns {Promise<object>} { project, dropped: blank new rows dropped, by
 *   list, stored: the indexes of the stored rows, by list } or { error } (a 400 answer)
 */
// eslint-disable-next-line max-statements, complexity
const validateProject = async (data, { shortname, oldProject = null, owner, findMissingUsers, rules } = {}) => {
  checkRules(rules, PROJECT_HOOKS, 'validateProject');
  if (typeof findMissingUsers !== 'function') {
    throw new TypeError('validateProject: findMissingUsers must be a function');
  }
  const parsed = parseProjectData(data);
  if (typeof parsed === 'undefined') {
    return { error: 'Invalid project data' };
  }
  const project = _.omit(sanitize(parsed), SERVER_FIELDS);
  const isNew = _.isNil(oldProject);
  const { stored, dropped } = sortLists(project, oldProject, rules);
  const error = shapeError(project, shortname, isNew) ||
    ownFieldsError(project, oldProject, rules) ||
    await rules.fieldsError(project, { oldProject, isNew }) ||
    rowsError(project, stored, rules) ||
    await rules.projectError(project, { oldProject, isNew, stored });
  if (error) {
    return { error };
  }
  if (!isNonEmptyString(owner)) {
    return { error: 'The project has no owner' };
  }
  // the owner is never the client's: the stored one, or the creator
  project.owner = owner;
  const missing = await findMissingUsers(usersToCheck(project, oldProject, owner, stored.collaborators, rules));
  if (Array.isArray(missing) && missing.length > 0) {
    return { error: `Unknown users: ${missing.join(', ')}` };
  }

  return { project, dropped, stored };
};

/**
 * Every problem of a project's rows, as if they were all new (microdraw's
 * rowProblemList, for the stored-project check): the per-row checks of
 * validateProject's step 7 (the same functions, so the two never disagree),
 * then its step 8 with no stored row. A missing list has no rows.
 * @param {object} project A project, sanitised by the caller
 * @param {object} rules The app's rules (collaboratorUser, fileError, layerError)
 * @returns {Array<object>} [{ list, row (index), message }]
 */
const projectRowProblems = (project, rules) => {
  checkRules(rules, ROW_HOOKS, 'projectRowProblems');
  const checks = rowChecks(rules);
  const problems = [];
  for (const type of LIST_TYPES) {
    listOf(project, type).forEach((row, i) => {
      const message = checks[type](row, i);
      if (message) {
        problems.push({ list: type, row: i, message });
      }
    });
  }
  for (const { row, message } of duplicateLayerNames(listOf(project, 'annotations'))) {
    problems.push({ list: 'annotations', row, message });
  }

  return problems;
};

module.exports = {
  validateProject,
  projectRowProblems,
  duplicateLayerNames,
  parseProjectData
};
