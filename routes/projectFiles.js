/**
 * GET /project/json/:projectName/files?start&length[&names=true]
 * (NeuroWebLab 1.17.0, stage 4 merge M10): a slice of the files of a
 * project's current version, from microdraw's
 * app/controller/project/project.controller.js (`apiProjectFilesUnsafe`,
 * `viewableProject`, `filesSlice`) and BrainBox's
 * controller/project/project.controller.js (`apiProjectFiles`) with
 * controller/dataSlices/dataSlices.js (`getProjectFilesSlice`). microdraw's
 * code is the reference; what each file of the slice is answered as (the
 * entry mapping) is the app's, as the data models differ.
 */
const { catchErrors } = require('../util/catchErrors');
const { findCurrentProject } = require('../project/versions');

/**
 * Throw if an adapter field is not a function
 * @param {string} route The route factory's name, for the message
 * @param {Object} adapter The adapter
 * @param {Array<string>} fields The fields that must be functions
 * @returns {void}
 */
const requireFunctions = (route, adapter, fields) => {
  if (adapter === null || typeof adapter !== 'object') {
    throw new TypeError(`${route}: an adapter object is needed`);
  }
  for (const field of fields) {
    if (typeof adapter[field] !== 'function') {
      throw new TypeError(`${route}: adapter.${field} must be a function`);
    }
  }
};

/**
 * An async handler whose errors go to `next`, so that the app's error handler
 * answers them (routes/notFound.js `errorHandler`); `catchErrors` stays as a
 * last guard
 * @param {function} handler An async (req, res) handler
 * @returns {function} An async Express handler, (req, res, next)
 */
const passErrors = (handler) => catchErrors((req, res, next) => handler(req, res).catch(next));

/**
 * A query value as a count: `parseInt`, a non-number or a negative value
 * counting as 0
 * @param {*} value The query value
 * @returns {number} An integer >= 0
 */
const count = (value) => Math.max(0, parseInt(value, 10) || 0);

/**
 * microdraw's `filesSlice`, without the entry mapping: the raw files from
 * `start`, at most `length`, cut to the list (an empty slice past its end)
 * @param {Object} project A project document
 * @param {*} start The query's `start`
 * @param {*} length The query's `length`
 * @returns {Array} The raw items of `files.list`; [] if it is not an array
 */
const filesSlice = (project, start, length) => {
  const list = (project.files && Array.isArray(project.files.list)) ? project.files.list : [];
  const from = Math.min(count(start), list.length);

  return list.slice(from, from + Math.min(count(length), list.length - from));
};

/**
 * The Express handler of GET /project/json/:projectName/files. In this order:
 * a missing `start` or `length` answers 200 `{error: "Provide 'start'"}` (or
 * `'length'`) before any read; an unknown project 404 `{error: 'No project
 * <name>'}`; no view right `adapter.noViewStatus(req)` with `{error: 'Not
 * authorized to view project'}`; else the slice, mapped by `adapter.entries`.
 * An error (a rejected read or `entries`) is passed to `next`, so that the
 * app's error handler answers it (routes/notFound.js `errorHandler`).
 * @param {Object} adapter What the app gives
 * @param {function} adapter.db (req) => the native MongoDB Db
 * @param {function} adapter.canView (req, project) => whether the requester may view the project's files
 * @param {function} adapter.noViewStatus (req) => the status of a refusal, 401 or 403
 * @param {function} adapter.entries (req, project, slice, {names}) => what is
 *        answered for the raw `files.list` items of the slice (may return a
 *        promise); `names` is true for `names=true`
 * @returns {function} An async Express handler, (req, res, next)
 */
const projectFilesRoute = (adapter) => {
  requireFunctions('projectFilesRoute', adapter, ['db', 'canView', 'noViewStatus', 'entries']);

  const handler = async (req, res) => {
    const missing = ['start', 'length'].find((key) => typeof req.query[key] === 'undefined');
    if (missing) {
      res.json({ error: `Provide '${missing}'` });

      return;
    }
    const { projectName } = req.params;
    const project = await findCurrentProject(adapter.db(req), projectName);
    if (!project) {
      res.status(404).json({ error: `No project ${projectName}` });

      return;
    }
    if (!await adapter.canView(req, project)) {
      res.status(adapter.noViewStatus(req)).json({ error: 'Not authorized to view project' });

      return;
    }
    const slice = filesSlice(project, req.query.start, req.query.length);
    res.json(await adapter.entries(req, project, slice, { names: req.query.names === 'true' }));
  };

  return passErrors(handler);
};

module.exports = { projectFilesRoute, filesSlice, passErrors, requireFunctions };
