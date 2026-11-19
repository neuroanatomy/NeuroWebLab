/**
 * GET /user/json/:userName/projects?[start][&length] (NeuroWebLab 1.22.0,
 * stage 4 merge M15a, decision D5 option B): a user's projects, as the
 * visitor may see them. One shared handler, the rows and the answer's object
 * the app's: from microdraw's app/controller/user/user.controller.js
 * (`userProjectsPage`, `api_userProjects`) with
 * app/controller/project/currentProject.js (`findUserProjects`), and
 * BrainBox's controller/user/user.controller.js (`apiUserProjects`) with
 * controller/dataSlices/dataSlices.js (`getUserProjectsSlice`).
 *
 * What stays the app's: the rows (BrainBox's `{project, projectName,
 * projectURL, numFiles, numCollaborators, owner, modified}`, the stored
 * `modified`; microdraw's visible project with its counts and its
 * `modified` rule, lastModified.js, which reads the newest annotations of the
 * whole page in one query), and the answer's object (BrainBox
 * `{success: list.length > 0, list}`, microdraw `{successful: true, list}`).
 */
const Configuration = require('../Configuration');
const { CURRENT } = require('../project/versions');
const { passErrors, requireFunctions } = require('./projectFiles');

// the keys of a collaborator row that may name the user (rows of every age)
const COLLABORATOR_KEYS = ['userID', 'username', 'nickname'];

/**
 * A `start` or `length` of the query: a string of decimal digits is that
 * number; anything else (missing, empty, negative, `1.5`, `abc`, an array) is
 * `fallback`, as if it were not given
 * @param {*} value The query value
 * @param {number} fallback The value when it is missing or not a count
 * @returns {number} An integer >= 0, or `fallback`
 */
const queryCount = (value, fallback) => (typeof value === 'string' && (/^\d+$/).test(value) ? Number(value) : fallback);

/**
 * The query of a user's current projects: the owner, or a collaborator row
 * naming the user by `userID`, `username` or `nickname`
 * @param {string} userName The user
 * @returns {object} The MongoDB filter
 */
const userProjectsQuery = (userName) => ({
  $or: [
    { owner: userName },
    ...COLLABORATOR_KEYS.map((key) => ({ [`collaborators.list.${key}`]: userName }))
  ],
  ...CURRENT
});

/**
 * The Express handler of GET /user/json/:userName/projects. In this order:
 * one read of the user's current projects (`userProjectsQuery`, in the
 * collection's natural order, unsorted, as both apps), those the visitor may
 * view (`canView`), then sliced: `length` of them from `start`, both
 * optional (no `start` from the first, no `length` all; a value that is not
 * a string of digits counts as not given; past the end, an empty page); then
 * `res.json(answer(await rows(req, page)))`. An unknown user has no
 * projects: the answer of an empty list. An error (a rejected read or
 * `rows`) goes to `next`, so that the app's error handler answers it
 * (routes/notFound.js `errorHandler`, a 500 `{error}`).
 * @param {object} adapter What the app gives
 * @param {function} adapter.db (req) => the native MongoDB Db
 * @param {function} adapter.canView (req, project) => whether the visitor may view the project (may return a promise)
 * @param {function} adapter.rows (req, page) => the rows of the page of
 *   visible projects (may return a promise); given the whole page, so that
 *   one query can read what the rows need
 * @param {function} adapter.answer (list) => the answer's object
 * @returns {function} An async Express handler, (req, res, next)
 */
const userProjectsRoute = (adapter) => {
  requireFunctions('userProjectsRoute', adapter, ['db', 'canView', 'rows', 'answer']);

  return passErrors(async (req, res) => {
    const start = queryCount(req.query.start, 0);
    const length = queryCount(req.query.length, Infinity);
    const projects = await adapter.db(req)
      .collection(Configuration.getInstance().projectsCollection)
      .find(userProjectsQuery(req.params.userName))
      .toArray();
    const allowed = await Promise.all(projects.map((project) => adapter.canView(req, project)));
    const page = projects.filter((project, i) => allowed[i]).slice(start, start + length);
    res.json(adapter.answer(await adapter.rows(req, page)));
  });
};

module.exports = { userProjectsRoute, userProjectsQuery, queryCount };
