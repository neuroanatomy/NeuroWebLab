/**
 * The shared project-management suite (conformance/README.md).
 * `require('neuroweblab/conformance').accessMatrix(adapter)`
 */
const { accessMatrix, RULES } = require('./accessMatrix');
const { client } = require('./http');
const { defaultRoutes, projectDocument, signUp } = require('./adapter');

module.exports = { RULES, accessMatrix, client, defaultRoutes, projectDocument, signUp };
