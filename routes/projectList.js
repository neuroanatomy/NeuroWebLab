/**
 * GET /project/json?page (NeuroWebLab 1.17.0, stage 4 merge M10): the
 * projects the requester may view, 20 per page. From microdraw's
 * app/controller/project/project.controller.js (`apiProjectAll`,
 * `viewableProjectNames`) and BrainBox's controller/project/project.controller.js
 * (`apiProjectAll`) with controller/dataSlices/dataSlices.js
 * (`getProjectsSlice`). The algorithm is both apps': read every current
 * project, keep the ones the requester may view, then page, so that a page
 * never holds a project the requester may not see, and every page is full
 * but the last. The row answered for a project is the app's.
 */
const Configuration = require('../Configuration');
const { CURRENT } = require('../project/versions');
const { passErrors, requireFunctions } = require('./projectFiles');

const PROJECTS_PER_PAGE = 20;

// BrainBox's: what its access check and its rows read (not the annotations)
const DEFAULT_PROJECTION = { _id: 0, shortname: 1, name: 1, owner: 1, collaborators: 1, 'files.list': 1 };

/**
 * The Express handler of GET /project/json?page. Without `page`: 200
 * `{error: "Provide the parameter 'page'"}`. The page is `parseInt(page)`, a
 * non-number or a negative value counting as 0. The current projects of the
 * configured `projectsCollection` are read (with `projection`), filtered by
 * `canView`, then the page's `PROJECTS_PER_PAGE` are answered as
 * `row(req, project)`. An error is passed to `next` (the app's error handler).
 * @param {Object} adapter What the app gives
 * @param {function} adapter.db (req) => the native MongoDB Db
 * @param {function} adapter.canView (req, project) => whether the requester may view the project's files
 * @param {function} adapter.row (req, project) => the row answered for a project (may return a promise)
 * @param {Object} [adapter.projection] The fields read of each project. It
 *        must hold every field `canView` and `row` read (the owner and the
 *        collaborators for the access check). Default:
 *        `{_id: 0, shortname: 1, name: 1, owner: 1, collaborators: 1, 'files.list': 1}`
 * @returns {function} An async Express handler, (req, res, next)
 */
const projectListRoute = (adapter) => {
  requireFunctions('projectListRoute', adapter, ['db', 'canView', 'row']);
  const { projection = DEFAULT_PROJECTION } = adapter;
  if (projection === null || typeof projection !== 'object') {
    throw new TypeError('projectListRoute: adapter.projection must be an object (a MongoDB projection) when given');
  }

  const handler = async (req, res) => {
    if (!req.query.page) {
      res.json({ error: 'Provide the parameter \'page\'' });

      return;
    }
    const page = Math.max(0, parseInt(req.query.page, 10) || 0);
    const projects = await adapter.db(req).collection(Configuration.getInstance().projectsCollection)
      .find(CURRENT, { projection })
      .toArray();
    // canView is synchronous in both apps; a promise is awaited too
    const viewable = await Promise.all(projects.map((project) => adapter.canView(req, project)));
    const visible = projects.filter((project, i) => viewable[i]);
    const onPage = visible.slice(page * PROJECTS_PER_PAGE, (page + 1) * PROJECTS_PER_PAGE);
    res.json(await Promise.all(onPage.map((project) => adapter.row(req, project))));
  };

  return passErrors(handler);
};

module.exports = { projectListRoute, PROJECTS_PER_PAGE, DEFAULT_PROJECTION };
