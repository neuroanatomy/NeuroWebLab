/**
 * The reference app's admin routes (test/conformanceApp.js), following
 * slice 5's approved rules (coordination tasks/proposed-shared-pm-tests.md,
 * "Slice 5: rules"): the JSON routes answer 401 logged out and 403 to
 * non-admins, by session or token; the page asks logged-out visitors to log
 * in (401); an admin change is a new version. Each `broken` option turns one
 * rule off, so the suite's own test can show the suite catches it.
 */
const { authTokenMiddleware } = require('../index');
const { clone } = require('./conformanceSave');

const LOGIN_PAGE = '<html><body><h1>Log in required</h1><p>Logging in is required to use the admin tools.</p></body></html>';

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
};

module.exports = { addAdminRoutes };
