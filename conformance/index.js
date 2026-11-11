/**
 * The shared project-management suite (conformance/README.md).
 * `require('neuroweblab/conformance').accessMatrix(adapter)` (slice 1),
 * `.projectLifecycle(adapter)` (slice 2): the same adapter for both.
 */
const { accessMatrix } = require('./accessMatrix');
const { projectLifecycle } = require('./projectLifecycle');
const { RULES } = require('./runner');
const { client } = require('./http');
const { defaultRoutes, projectDocument, signUp } = require('./adapter');

module.exports = { RULES, accessMatrix, client, defaultRoutes, projectDocument, projectLifecycle, signUp };
