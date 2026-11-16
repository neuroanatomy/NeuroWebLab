/**
 * Validation helpers for project documents: sanitising, and the rows of a
 * project sent compared with the stored ones (NeuroWebLab 1.10.0, stage 4
 * merge M3). The apps' code: microdraw
 * app/controller/project/project.validation.js and project.controller.js,
 * BrainBox controller/project/project.controller.js and project-rows.js. Where
 * the two differ, it says which app's version it is.
 */
const _ = require('lodash');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

/**
 * The DOMPurify instance, over a jsdom window that loads nothing and runs no
 * script. Created once per process, on the first string that needs it.
 * @type {object|undefined}
 */
let purifier;
const getPurifier = () => {
  if (typeof purifier === 'undefined') {
    const { window } = new JSDOM('', {
      features: {
        FetchExternalResources: false, // disables resource loading over HTTP / filesystem
        ProcessExternalResources: false // do not execute JS within script blocks
      }
    });
    purifier = createDOMPurify(window);
  }

  return purifier;
};

// a new project's shortname: letters, numbers and hyphens (shared suite 2.6, 2026-11-11). Both
// apps' expression.
const shortnamePattern = /^[a-zA-Z0-9-]+$/;

/**
 * Plain text of a string: markup removed by DOMPurify, text kept. A string
 * without "<" holds no markup and is kept as it is, "&" included (DOMPurify
 * would turn "&" into "&amp;" in URLs). Both apps' code.
 * @param {string} str A string
 * @returns {string} The string without markup
 */
const plainText = (str) => {
  if (!str.includes('<')) {
    return str;
  }

  return getPurifier().sanitize(str, { ALLOWED_TAGS: [], KEEP_CONTENT: true, RETURN_DOM_FRAGMENT: true }).textContent;
};

/**
 * A copy of a JSON value with every string sanitised (plainText): arrays and
 * plain objects are copied, any other value is returned as it is. microdraw's
 * `sanitize`, BrainBox's `sanitizeValue` (the same code).
 * @param {*} value A value parsed from JSON
 * @returns {*} The sanitised copy
 */
const sanitize = (value) => {
  if (typeof value === 'string') {
    return plainText(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (_.isPlainObject(value)) {
    return _.mapValues(value, sanitize);
  }

  return value;
};

/**
 * Whether a value is blank: null, undefined, or a string of spaces only
 * @param {*} v A value
 * @returns {boolean} True if blank
 */
const isBlank = (v) => v === null || typeof v === 'undefined' || (typeof v === 'string' && v.trim() === '');

/**
 * A value to compare rows on: null, undefined and blank strings are all ''
 * (the settings page may send '' for a stored null)
 * @param {*} v A value
 * @returns {*} '' if blank, else the value
 */
const text = (v) => (isBlank(v) ? '' : v);

/**
 * A list of a project: project[type].list, or [] if there is none
 * @param {object} project A project
 * @param {string} type files, collaborators or annotations
 * @returns {Array} The list
 */
const listOf = (project, type) => ((project && _.isPlainObject(project[type]) && Array.isArray(project[type].list)) ? project[type].list : []);

/**
 * Rows left empty (e.g. by the settings page's "+" button), by list. A
 * collaborator row is blank if it names no user under any key the apps read:
 * `username`, `userID` or `nickname` (BrainBox's; microdraw's did not read
 * `nickname`, see sortRows' `isBlankRow` option).
 */
const isBlankRow = {
  files: (f) => _.isPlainObject(f) && isBlank(f.source) && isBlank(f.name),
  collaborators: (c) => _.isPlainObject(c) && isBlank(c.username) && isBlank(c.userID) && isBlank(c.nickname),
  annotations: (a) => _.isPlainObject(a) && isBlank(a.name) && isBlank(a.values)
};

// a clear error for a caller that does not give its rowKey
const checkRowKey = (rowKey, type) => {
  if (!rowKey || typeof rowKey[type] !== 'function') {
    throw new TypeError(`sortRows needs options.rowKey.${type}`);
  }
};

/**
 * Sort the rows of one list of the project sent (shared suite 2.14). A row
 * equal to a stored row (on `rowKey`; each stored row matches at most one row
 * sent, wherever it is) is a stored row, accepted as it is; a blank row that
 * is not stored is dropped; the others are new or changed, and checked.
 *
 * What a row is compared on differs between the apps (their row shapes), so
 * each passes its own `rowKey`. The stored rows are compared as given: the
 * caller sanitises them as it sanitised the rows sent (BrainBox's form;
 * microdraw's sortRows sanitised each stored row itself, the same as passing
 * `listOf(oldProject, type).map(sanitize)`).
 * @param {string} type The list: files, collaborators or annotations
 * @param {Array} rows The rows sent, sanitised
 * @param {Array} oldRows The stored rows, sanitised as the rows sent
 * @param {object} options Options
 * @param {object<string, function(*): *>} options.rowKey What a row of each list is compared on
 * @param {object<string, function(*): boolean>} [options.isBlankRow] Which rows are blank, by list (default: isBlankRow)
 * @returns {object} { kept: the rows without the dropped ones, stored: Set of
 *   the indexes in kept of the stored rows, dropped: how many were dropped }
 */
const sortRows = (type, rows, oldRows, { rowKey, isBlankRow: blankRow = isBlankRow } = {}) => {
  checkRowKey(rowKey, type);
  const available = oldRows.map(rowKey[type]);
  const kept = [];
  const stored = new Set();
  let dropped = 0;
  for (const row of rows) {
    const key = rowKey[type](row);
    const at = available.findIndex((k) => _.isEqual(k, key));
    if (at >= 0) {
      available.splice(at, 1);
      stored.add(kept.length);
      kept.push(row);
    } else if (blankRow[type](row)) {
      dropped += 1;
    } else {
      kept.push(row);
    }
  }

  return { kept, stored, dropped };
};

/**
 * The text added to a save's success message for the blank rows that were
 * dropped (shared suite 2.14), with its leading space, or '' if none. Both
 * apps' text; `dropped` may be missing (BrainBox's).
 * @param {object<string, number>} [dropped] How many rows were dropped, by list
 * @returns {string} ' Empty rows were not saved (1 files, 2 annotations).', or ''
 */
const droppedMessage = (dropped) => {
  const parts = Object.entries(dropped || {})
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${n} ${type}`);

  return parts.length > 0 ? ` Empty rows were not saved (${parts.join(', ')}).` : '';
};

module.exports = {
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
