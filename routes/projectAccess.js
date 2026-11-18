/**
 * The project routes' access skeleton (NeuroWebLab 1.21.0, stage 4 merge
 * M14a, decisions D1 option C and D4 option B): who the visitor is, and five
 * route factories, for the project page, its settings page, its JSON, its
 * save and its delete, from both apps' project.controller.js (microdraw's
 * `getLoggedUser`, `noViewStatus`, `project`, `settingsUnsafe`,
 * `apiProjectUnsafe`, `postProjectUnsafe`, `deleteProjectUnsafe`; BrainBox's
 * `noViewStatus`, `project`, `apiProject`, `settings`, `postProject`, `deleteProject`).
 *
 * The factories do what both apps repeated in each handler: find the current
 * project, answer 404, check the view right, take the lock, and pass errors
 * to `next`, so that the app's error handler answers them (routes/notFound.js
 * `errorHandler`: a page as a page, JSON as JSON). Everything that differs
 * between the apps is a hook of the adapter.
 *
 * What stays the app's: BrainBox's express-validator `validator` (400 on a
 * malformed `:projectName`, mounted before the route); the `/project/new`
 * page; the routers and the middleware order (`authTokenMiddleware` where
 * each app puts it, on the JSON routes); the hooks `canView`, `canRemove`,
 * `visible`, `render`, `blankProject`, `save` and `remove`, which map
 * `visitor(req) === null` to the app's sentinel (`'anonymous'` in BrainBox,
 * `'anyone'` in microdraw): no sentinel enters NWL's signatures.
 */
const { findCurrentProject } = require('../project/versions');
const { withLock } = require('../project/lock');
const { passErrors, requireFunctions } = require('./projectFiles');

const [NO_VIEW, NOT_AUTHENTICATED] = ['Not authorized to view project', 'User not authenticated'];
const [DELETE_NOT_FOUND, DELETE_REFUSED] = ['Project not found', 'The user is not allowed to delete this project'];

// the project is read without its `_id` (it changes on every save, T002 2.1b)
const DEFAULT_PROJECTION = { _id: 0 };

/**
 * Who the visitor is. NWL's `authTokenMiddleware` sets `req.user =
 * {username}` for a valid token (an expired or unknown one sets nothing), and
 * passport's `isAuthenticated()` is true when `req.user` is set: so sessions
 * and tokens are both covered, and `req.isTokenAuthenticated` adds nothing.
 * @param {object} req The Express request
 * @returns {string|null} The username, or null when logged out (also for a
 *   request without `isAuthenticated`, or a user without a string username)
 */
const visitor = (req) => {
  if (!req || typeof req.isAuthenticated !== 'function' || !req.isAuthenticated()) {
    return null;
  }

  return (req.user && typeof req.user.username === 'string') ? req.user.username : null;
};

/**
 * The status of a refusal to view a project (shared suite 1.5): 401 logged
 * out ("who are you?"), 403 logged in, by session or by token
 * @param {object} req The Express request
 * @returns {number} 401 or 403
 */
const noViewStatus = (req) => (visitor(req) === null ? 401 : 403);

/**
 * The adapter's projection, checked (as projectListRoute's)
 * @param {string} route The route factory's name, for the message
 * @param {object} adapter The adapter
 * @returns {object} The projection
 */
const projectionOf = (route, adapter) => {
  const { projection = DEFAULT_PROJECTION } = adapter;
  if (projection === null || typeof projection !== 'object') {
    throw new TypeError(`${route}: adapter.projection must be an object (a MongoDB projection) when given`);
  }

  return projection;
};

/**
 * The current version of the project of the URL. Every factory that reads it
 * takes `adapter.db`, (req) => the native MongoDB Db, and
 * `adapter.projection`, what is read (default `{_id: 0}`; `{}` for the whole
 * document)
 * @param {object} adapter The adapter (`db`)
 * @param {object} projection The projection
 * @param {object} req The request
 * @returns {Promise<object|null>} The project, or null
 */
const currentProject = (adapter, projection, req) => findCurrentProject(adapter.db(req), req.params.projectName, { projection });

/**
 * Store the page's URL as the return path of a login, if there is a session
 * @param {object} req The request
 * @returns {void}
 */
const keepReturnPath = (req) => {
  if (req.session) {
    req.session.returnTo = req.originalUrl;
  }
};

/**
 * The value at a `?var=a/b` path, own properties only: a step that is not an
 * own property is `undefined`, and a step through `undefined` or `null`
 * throws a `TypeError` (as before: a 500)
 * @param {*} value The project as the visitor may see it
 * @param {string} path The path, `/`-separated
 * @returns {*} The value
 */
// eslint-disable-next-line no-undefined -- a missing value is undefined, as res.json(undefined) answered before
const valueAt = (value, path) => path.split('/').reduce((v, key) => (Object.hasOwn(v, key) ? v[key] : undefined), value);

/**
 * GET /project/:projectName. In this order: `req.session.returnTo =
 * req.originalUrl` (if there is a session); an unknown project 404, text
 * `Project Not Found`; no view right `noViewStatus(req)`, text `Not
 * authorized to view project`; else `render(req, res, project)`. An error (a
 * rejected read or hook) goes to `next`.
 * @param {object} adapter What the app gives (db, projection and:)
 * @param {function} adapter.canView (req, project) => whether the visitor may view the project
 * @param {function} adapter.render (req, res, project) => answers the page (may return a promise)
 * @returns {function} An async Express handler, (req, res, next)
 */
const projectPageRoute = (adapter) => {
  requireFunctions('projectPageRoute', adapter, ['db', 'canView', 'render']);
  const projection = projectionOf('projectPageRoute', adapter);

  return passErrors(async (req, res) => {
    keepReturnPath(req);
    const project = await currentProject(adapter, projection, req);
    if (!project) {
      res.status(404).send('Project Not Found');

      return;
    }
    if (!await adapter.canView(req, project)) {
      res.status(noViewStatus(req)).send(NO_VIEW);

      return;
    }
    await adapter.render(req, res, project);
  });
};

/**
 * GET /project/:projectName/settings. In this order: `returnTo`, as the
 * page; a stored project without the view right `noViewStatus(req)`, text
 * `Not authorized to view project`; no stored project: `blankProject(req)`,
 * whose view right is not checked (the visitor owns it); then `render(req,
 * res, project, {isNew})`. Emptying `files.list`, `filesLoaded`, the
 * collaborators' names and the page's context stay in `render`. An error goes
 * to `next`.
 * @param {object} adapter What the app gives (db, projection and:)
 * @param {function} adapter.canView (req, project) => whether the visitor may view the project
 * @param {function} adapter.blankProject (req) => the new project the settings page shows for an unknown shortname
 * @param {function} adapter.render (req, res, project, {isNew}) => answers the page
 * @returns {function} An async Express handler, (req, res, next)
 */
const projectSettingsRoute = (adapter) => {
  requireFunctions('projectSettingsRoute', adapter, ['db', 'canView', 'blankProject', 'render']);
  const projection = projectionOf('projectSettingsRoute', adapter);

  return passErrors(async (req, res) => {
    keepReturnPath(req);
    const stored = await currentProject(adapter, projection, req);
    if (stored && !await adapter.canView(req, stored)) {
      res.status(noViewStatus(req)).send(NO_VIEW);

      return;
    }
    const isNew = !stored;
    const project = isNew ? await adapter.blankProject(req) : stored;
    await adapter.render(req, res, project, { isNew });
  });
};

/**
 * GET /project/json/:projectName. In this order: an unknown project 404
 * `{error: 'No project <name>'}`; no view right `noViewStatus(req)` with
 * `{error: 'Not authorized to view project'}`; else `visible(req, project)`,
 * what the visitor may see, and with `?var=a/b` the value at that path (own
 * properties only: a path that ends on a missing value answers
 * `res.json(undefined)`, an empty 200; a path through one goes to `next`, a
 * 500), sent with `res.json`. An error goes to `next`.
 * @param {object} adapter What the app gives (db, projection and:)
 * @param {function} adapter.canView (req, project) => whether the visitor may view the project
 * @param {function} adapter.visible (req, project) => the project as the visitor may see it (may return a promise)
 * @returns {function} An async Express handler, (req, res, next)
 */
const projectJsonRoute = (adapter) => {
  requireFunctions('projectJsonRoute', adapter, ['db', 'canView', 'visible']);
  const projection = projectionOf('projectJsonRoute', adapter);

  return passErrors(async (req, res) => {
    const { projectName } = req.params;
    const project = await currentProject(adapter, projection, req);
    if (!project) {
      res.status(404).json({ error: `No project ${projectName}` });

      return;
    }
    if (!await adapter.canView(req, project)) {
      res.status(noViewStatus(req)).json({ error: NO_VIEW });

      return;
    }
    const shown = await adapter.visible(req, project);
    // as before, a `var` that is not a string (`?var=a&var=b`) throws: a 500
    res.json(req.query.var ? valueAt(shown, req.query.var) : shown);
  });
};

/**
 * The answer of a refused save or delete: the reason in `error`, which the
 * settings page shows (nwl-components ProjectInfo.vue), and in `message`
 * @param {object} res The response
 * @param {number} status The status
 * @param {string} reason The reason
 * @returns {void}
 */
const refuse = (res, status, reason) => {
  res.status(status).json({ success: false, error: reason, message: reason });
};

/**
 * POST /project/json/:projectName. Logged out: 401 `{success: false, error:
 * 'User not authenticated', message: …}`, without taking the lock. Else
 * `save(req, res, username)` holding `withLock(lockKeys(req))` (project/lock.js,
 * the lock of the apps' projectLock.js). The save, its 403 and 400 and its
 * answer are the app's. An error goes to `next` (a 500).
 * @param {object} adapter What the app gives
 * @param {function} adapter.lockKeys (req) => the keys of the lock (microdraw
 *   `[projectKey(name)]`, BrainBox `['project', 'mri']`)
 * @param {function} adapter.save (req, res, username) => saves and answers (may return a promise)
 * @returns {function} An async Express handler, (req, res, next)
 */
const projectSaveRoute = (adapter) => {
  requireFunctions('projectSaveRoute', adapter, ['lockKeys', 'save']);

  return passErrors(async (req, res) => {
    const username = visitor(req);
    if (username === null) {
      refuse(res, 401, NOT_AUTHENTICATED);

      return;
    }
    await withLock(adapter.lockKeys(req), () => adapter.save(req, res, username));
  });
};

/**
 * DELETE /project/json/:projectName (the route wrapper of decision D4 B; the
 * delete itself is the app's). Logged out: 401, as the save, without taking
 * the lock. Else, holding `withLock(lockKeys(req))`: an unknown project 404
 * `{success: false, error: 'Project not found', message: …}`; `canRemove`
 * false 403 `{success: false, error: 'The user is not allowed to delete this
 * project', message: …}`; else `extra = await remove(req, project,
 * username)`, then 200 `{success: true, message: 'Project deleted',
 * ...extra}`. An error goes to `next` (a 500).
 * @param {object} adapter What the app gives (db, projection and:)
 * @param {function} adapter.lockKeys (req) => the keys of the lock
 * @param {function} adapter.canRemove (req, project) => whether the visitor may delete the project
 * @param {function} adapter.remove (req, project, username) => deletes it;
 *   resolves with the fields added to the answer (microdraw `{log}`, BrainBox
 *   nothing)
 * @returns {function} An async Express handler, (req, res, next)
 */
const projectDeleteRoute = (adapter) => {
  requireFunctions('projectDeleteRoute', adapter, ['db', 'lockKeys', 'canRemove', 'remove']);
  const projection = projectionOf('projectDeleteRoute', adapter);

  return passErrors(async (req, res) => {
    const username = visitor(req);
    if (username === null) {
      refuse(res, 401, NOT_AUTHENTICATED);

      return;
    }
    await withLock(adapter.lockKeys(req), async () => {
      const project = await currentProject(adapter, projection, req);
      if (!project) {
        refuse(res, 404, DELETE_NOT_FOUND);

        return;
      }
      if (!await adapter.canRemove(req, project)) {
        refuse(res, 403, DELETE_REFUSED);

        return;
      }
      const extra = await adapter.remove(req, project, username);
      res.json({ success: true, message: 'Project deleted', ...(extra || {}) });
    });
  });
};

module.exports = {
  visitor,
  noViewStatus,
  projectPageRoute,
  projectSettingsRoute,
  projectJsonRoute,
  projectSaveRoute,
  projectDeleteRoute
};
