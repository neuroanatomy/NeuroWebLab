/**
 * The damaged projects routes (NeuroWebLab 1.24.0, T002 R1a): the three
 * Express handlers of both apps' admin tools, over what `damagedProjects`
 * (damaged.js) returns. microdraw's handlers
 * (`app/controller/admin/admin.controller.js`) are the reference: the body
 * checks and their texts, `sendResult` for all three answers. The apps keep
 * their paths and middleware (`requireAdmin`).
 *
 * - GET  /admin/json/projects/damaged       → { success: true, list }
 * - POST /admin/json/projects/restore-files  { project, version, save }
 * - POST /admin/json/projects/fix-current    { project, version }
 *
 * A bad body is a 400 { success: false, error } with the texts below; a
 * `{status, error}` from the fix (404, 409) is answered as it is; a thrown
 * error is a 500 'Server error', logged by `sendResult`'s logger.
 */
const { sendResult } = require('./actions');
const { requestUsername: sessionUsername } = require('./admins');

/**
 * The project and its version token (as listed) of a fix's body, or the
 * reason the body is invalid. microdraw's other admin fixes use it too.
 * @param {object} [body] The request body: { project, version, ... }
 * @returns {object} { shortname, version } or { error }
 */
const projectFromBody = (body) => {
  const fields = body || {};
  if (typeof fields.project !== 'string' || fields.project === '') {
    return { error: 'Provide the project shortname' };
  }
  if (typeof fields.version !== 'string' || fields.version === '') {
    return { error: 'Provide the version of the project, as listed' };
  }

  return { shortname: fields.project, version: fields.version };
};

const badRequest = (res, error) => res.status(400).json({ success: false, error });

/**
 * The Express handlers of the damaged projects tools
 * @param {object} damaged What `damagedProjects(adapter)` returns
 * @param {object} options Options
 * @param {function(object): object} options.nativeDb req => the native MongoDB Db
 *   (microdraw: req.app.db.nativeMongoDB(); BrainBox: req.nativeDb)
 * @param {function(object): string|null} [options.requestUsername] req => the
 *   admin's username, logged with the fix; by default NeuroWebLab's
 * @param {object} [options.logger] Logger of the 500s (pino's error({ err },
 *   message)); by default console.log('ERROR:', err), as sendResult's
 * @returns {object} { getDamagedProjects, restoreProjectFiles,
 *   fixProjectCurrentVersions }, Express handlers (req, res)
 */
const damagedProjectsRoutes = (damaged, { nativeDb, requestUsername = sessionUsername, logger } = {}) => {
  if (damaged === null || typeof damaged !== 'object') {
    throw new TypeError('damagedProjectsRoutes: the object returned by damagedProjects is needed');
  }
  for (const field of ['findDamagedProjects', 'restoreFiles', 'fixCurrentVersions']) {
    if (typeof damaged[field] !== 'function') {
      throw new TypeError(`damagedProjectsRoutes: damaged.${field} must be a function`);
    }
  }
  if (typeof nativeDb !== 'function') {
    throw new TypeError('damagedProjectsRoutes: options.nativeDb must be a function (req => db)');
  }
  if (typeof requestUsername !== 'function') {
    throw new TypeError('damagedProjectsRoutes: options.requestUsername must be a function');
  }
  const options = logger ? { logger } : {};
  // the action runs inside the promise, so that a throw (nativeDb included) is a 500
  const answer = (res, action) => sendResult(res, Promise.resolve().then(action), options);

  /**
   * List the damaged projects. Answer: { success: true, list }
   * @param {object} req Request object
   * @param {object} res Response object
   * @returns {Promise<void>} Resolves once answered
   */
  const getDamagedProjects = (req, res) => answer(res, () => damaged.findDamagedProjects(nativeDb(req)));

  /**
   * Add back the files a save removed that are still missing, as a new
   * version. Body: { project, version, save } (version: the token, save: the
   * id of the version the save stored, as listed)
   * @param {object} req Request object
   * @param {object} res Response object
   * @returns {Promise<void>|void} Resolves once answered
   */
  const restoreProjectFiles = (req, res) => {
    const body = req.body || {};
    const { shortname, version, error } = projectFromBody(body);
    if (error) {
      return badRequest(res, error);
    }
    if (typeof body.save !== 'string' || body.save === '') {
      return badRequest(res, 'Provide the save: the id of the version it stored, as listed');
    }

    return answer(res, () => damaged.restoreFiles(nativeDb(req), { shortname, version, save: body.save, username: requestUsername(req) }));
  };

  /**
   * Keep the newest of several current versions of a project, mark the
   * others backup. Body: { project, version } (the token, as listed)
   * @param {object} req Request object
   * @param {object} res Response object
   * @returns {Promise<void>|void} Resolves once answered
   */
  const fixProjectCurrentVersions = (req, res) => {
    const { shortname, version, error } = projectFromBody(req.body);
    if (error) {
      return badRequest(res, error);
    }

    return answer(res, () => damaged.fixCurrentVersions(nativeDb(req), { shortname, version, username: requestUsername(req) }));
  };

  return { getDamagedProjects, restoreProjectFiles, fixProjectCurrentVersions };
};

module.exports = {
  damagedProjectsRoutes,
  projectFromBody
};
