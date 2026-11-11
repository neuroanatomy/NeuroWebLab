/**
 * The shared project-management suite (conformance/README.md).
 * `require('neuroweblab/conformance').accessMatrix(adapter)` (slice 1),
 * `.projectLifecycle(adapter)` (slice 2), `.projectListings(adapter)`
 * (slice 3): the same adapter for all three.
 */
const { accessMatrix } = require('./accessMatrix');
const { projectLifecycle } = require('./projectLifecycle');
const { projectListings } = require('./projectListings');
const { RULES } = require('./runner');
const { client } = require('./http');
const { defaultRoutes, projectDocument, signUp } = require('./adapter');

module.exports = { RULES, accessMatrix, client, defaultRoutes, projectDocument, projectLifecycle, projectListings, signUp };
