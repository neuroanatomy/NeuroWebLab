/**
 * The shared project-management suite (conformance/README.md).
 * `require('neuroweblab/conformance').accessMatrix(adapter)` (slice 1),
 * `.projectLifecycle(adapter)` (slice 2), `.projectListings(adapter)`
 * (slice 3), `.projectAnnotations(adapter)` (slice 4): the same adapter for
 * all four.
 */
const { accessMatrix } = require('./accessMatrix');
const { projectLifecycle } = require('./projectLifecycle');
const { projectListings } = require('./projectListings');
const { projectAnnotations } = require('./projectAnnotations');
const { RULES } = require('./runner');
const { client } = require('./http');
const { defaultRoutes, projectDocument, signUp } = require('./adapter');

module.exports = { RULES, accessMatrix, client, defaultRoutes, projectAnnotations, projectDocument, projectLifecycle, projectListings, signUp };
