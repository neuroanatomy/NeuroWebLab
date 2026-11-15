/**
 * Pure helpers shared by the apps (NeuroWebLab 1.8.0). Each name is also
 * exported from the root `index.js`.
 */
const { escapeRegex } = require('../db/escapeRegex');
const { jsonForScript, jsonForAttribute } = require('./jsonForScript');
const { toId } = require('./toId');
const { catchErrors } = require('./catchErrors');

module.exports = {
  escapeRegex,
  jsonForScript,
  jsonForAttribute,
  toId,
  catchErrors
};
