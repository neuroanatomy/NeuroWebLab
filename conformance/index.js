/**
 * The shared project-management suite (conformance/README.md).
 * `require('neuroweblab/conformance').accessMatrix(adapter)` (slice 1),
 * `.projectLifecycle(adapter)` (slice 2), `.projectListings(adapter)`
 * (slice 3), `.projectAnnotations(adapter)` (slice 4), `.projectAdmin(adapter)`
 * (slice 5): the same adapter for all five.
 */
const { accessMatrix } = require('./accessMatrix');
const { projectLifecycle } = require('./projectLifecycle');
const { projectListings } = require('./projectListings');
const { projectAnnotations } = require('./projectAnnotations');
const { projectAdmin } = require('./projectAdmin');
const { RULES } = require('./runner');
const { client } = require('./http');
const { defaultRoutes, projectDocument, signUp } = require('./adapter');

module.exports = { RULES, accessMatrix, client, defaultRoutes, projectAdmin, projectAnnotations, projectDocument, projectLifecycle, projectListings, signUp };
