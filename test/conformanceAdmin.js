/**
 * The reference app's admin routes (test/conformanceApp.js), following
 * slice 5's approved rules (coordination tasks/proposed-shared-pm-tests.md,
 * "Slice 5: rules"): the JSON routes answer 401 logged out and 403 to
 * non-admins, by session or token; the page asks logged-out visitors to log
 * in (401); an admin change is a new version. Each `broken` option turns one
 * rule off, so the suite's own test can show the suite catches it.
 */
const { authTokenMiddleware, projectVersion } = require('../index');
const { removalEvents } = require('../admin/damaged');
const { clone } = require('./conformanceSave');

const LOGIN_PAGE = '<html><body><h1>Log in required</h1><p>Logging in is required to use the admin tools.</p></body></html>';

// the file rows of a version, as {source, name}; plain strings a source without a name
const fileRows = (v) => ((v.files && Array.isArray(v.files.list)) ? v.files.list : [])
  .map((r) => (typeof r === 'string' ? { source: r, name: '' } : { source: r.source, name: r.name }));

// the rows of the version before the save that it removed and the current version lacks
const rowsToRestore = (versions, save, current) => {
  const index = versions.findIndex((v) => v._id === save);
  if (index < 1) {
    return [];
  }
  const kept = new Set([...fileRows(current), ...fileRows(versions[index])].map((r) => r.source));

  return fileRows(versions[index - 1]).filter((r) => !kept.has(r.source));
};

/**
 * The damaged projects routes (slice 5: 5.6, 5.7), microdraw's paths, list
 * and bodies, over the store: the token is NWL's projectVersion of the
 * current version, the events NWL's removalEvents. `noVersionCheck`: the
 * token is not checked; `restoreDropsNames`: the rows put back are plain
 * sources; `restoreInPlace`: the current version is changed, no new one.
 * @param {object} app The express app
 * @param {object} store The projects (conformanceApp.js makeStore), with `adminLog`
 * @param {object} broken The rules turned off
 * @param {function} requireAdmin The admin check
 * @returns {void}
 */
const addDamagedRoutes = (app, store, broken, requireAdmin) => {
  const currents = (p) => store.versions(p).filter((v) => !v.backup);
  const stale = (p, version) => !broken.noVersionCheck && projectVersion(store.current(p)) !== version;
  // the rows added after the current ones, as a new version
  const restore = (current, rows, username) => {
    const added = broken.restoreDropsNames ? rows.map((r) => r.source) : rows;
    if (broken.restoreInPlace) {
      current.files.list.push(...added);

      return;
    }
    const next = { ...clone(current), files: { list: [...current.files.list, ...clone(added)] }, modifiedBy: username };
    delete next._id;
    store.saveVersion(next);
  };

  app.get('/admin/json/projects/damaged', authTokenMiddleware, requireAdmin, (req, res) => {
    const shortnames = [...new Set(store.listed().map((p) => p.shortname))];
    const list = shortnames.map((p) => {
      const now = new Set(fileRows(store.current(p)).map((r) => r.source));
      const events = removalEvents(store.versions(p), now, fileRows);

      return { shortname: p, version: projectVersion(store.current(p)), currentVersions: currents(p).length, events };
    }).filter((e) => e.events.length > 0 || e.currentVersions > 1);
    res.json({ success: true, list });
  });

  app.post('/admin/json/projects/restore-files', authTokenMiddleware, requireAdmin, (req, res) => {
    const { project, version, save } = req.body || {};
    if (typeof project !== 'string' || currents(project).length !== 1) {
      return res.status(404).json({ success: false, error: 'Not one current version' });
    }
    if (stale(project, version)) {
      return res.status(409).json({ success: false, error: 'changed since listed' });
    }
    const current = store.current(project);
    const rows = rowsToRestore(store.versions(project), save, current);
    if (rows.length === 0) {
      return res.status(409).json({ success: false, error: 'nothing to restore' });
    }
    store.adminLog.push({ key: 'adminRestoreProjectFiles', value: { shortname: project } });
    restore(current, rows, req.user.username);
    res.json({ success: true });
  });

  app.post('/admin/json/projects/fix-current', authTokenMiddleware, requireAdmin, (req, res) => {
    const { project, version } = req.body || {};
    const list = typeof project === 'string' ? currents(project) : [];
    if (list.length === 0) {
      return res.status(404).json({ success: false, error: 'no project' });
    }
    if (stale(project, version)) {
      return res.status(409).json({ success: false, error: 'changed since listed' });
    }
    if (list.length < 2) {
      return res.status(409).json({ success: false, error: 'not several' });
    }
    store.markOlderCurrents(project);
    store.adminLog.push({ key: 'adminFixCurrentVersions', value: { shortname: project } });
    res.json({ success: true });
  });
};

/**
 * Add the admin routes
 * @param {object} app The express app, on which NeuroWebLab's init() ran
 * @param {object} store The projects (conformanceApp.js makeStore)
 * @param {object} broken The rules turned off
 * @param {Set<string>} admins The admins' usernames
 * @returns {void}
 */
const addAdminRoutes = (app, store, broken, admins) => {
  const isAdmin = (req) => Boolean(req.user) && (admins.has(req.user.username) || Boolean(broken.nonAdminAllowed));
  // `adminTokenRefused`: a token does not count as a login here
  const userOf = (req) => (broken.adminTokenRefused && req.query.token ? null : req.user);

  const requireAdmin = (req, res, next) => {
    if (!userOf(req)) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Admins only' });
    }
    next();
  };

  app.get('/admin', authTokenMiddleware, (req, res) => {
    if (!userOf(req)) {
      // `pageOpen`: 200, as BrainBox today; `pageNoPrompt`: 401 without the login prompt
      return res.status(broken.pageOpen ? 200 : 401).send(broken.pageNoPrompt ? '' : LOGIN_PAGE);
    }
    if (!isAdmin(req)) {
      return res.status(403).send('Admins only');
    }
    res.send('<html><body><h1>Admin tools</h1></body></html>');
  });

  app.get('/admin/json/projects', authTokenMiddleware, requireAdmin, (req, res) => {
    res.json({ success: true, list: store.listed().map((p) => p.shortname) });
  });

  // rename a project: a new version, the previous ones kept as backups
  app.post('/admin/json/projects/rename', authTokenMiddleware, requireAdmin, (req, res) => {
    const { project, name } = req.body || {};
    const current = typeof project === 'string' ? store.current(project) : null;
    if (!current || typeof name !== 'string' || name === '') {
      return res.status(400).json({ success: false, error: 'Provide the project and its new name' });
    }
    if (broken.overwriteNoBackup) {
      // the current version changed in place: no new version, the previous content lost
      current.name = name;

      return res.json({ success: true });
    }
    const version = { ...clone(current), name, modified: (new Date()).toJSON(), modifiedBy: req.user.username };
    delete version._id;
    store.saveVersion(version);
    if (broken.backupChanged) {
      // a new version, but the previous one is changed too
      store.lastBackup(project).name = name;
    }
    res.json({ success: true });
  });

  addDamagedRoutes(app, store, broken, requireAdmin);
};

module.exports = { addAdminRoutes };
