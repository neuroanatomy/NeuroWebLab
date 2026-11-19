/**
 * The reference app's user routes (test/conformanceApp.js): a user's
 * projects, built with NeuroWebLab's `userProjectsRoute` (1.22.0) over the
 * store as a Db stub, and `GET /user/json/:u`, with `publicUser`. The
 * `broken` variants are applied around the factory or in its hooks:
 * `userIDOnly` (3.3) and `noNickname` (3.16) are keys the store's find never
 * matches; `sliceBeforeFilter` (3.4) makes the read page by the query before
 * the factory filters; `rangeRequired` (3.4) and `nonNumericAsZero` (3.18)
 * answer, or rewrite the query, before the factory; `hiddenCollaboratorsCounted`
 * and `noModified` (3.5) are in `rows`; `noListWhenEmpty` (3.17) is in
 * `answer`; `userDocumentExposed` (3.19) answers the whole user document.
 */
const { AccessControlService: ACS, catchErrors, publicUser, userProjectsRoute } = require('../index');
const { storeDb } = require('./conformanceAccess');

const DIGITS = /^\d+$/;

/**
 * Before the factory: `rangeRequired` refuses a request without both
 * `start` and `length`; `nonNumericAsZero` reads a `start` or `length` that
 * is not a string of digits as 0
 * @param {object} broken The rules turned off
 * @returns {function} An express middleware
 */
const rangeVariants = (broken) => (req, res, next) => {
  const { start, length } = req.query;
  if (broken.rangeRequired && (typeof start === 'undefined' || typeof length === 'undefined')) {
    res.status(403).json({ error: 'Provide start and length' });

    return;
  }
  if (broken.nonNumericAsZero) {
    for (const key of ['start', 'length']) {
      if (typeof req.query[key] !== 'undefined' && !DIGITS.test(req.query[key])) {
        req.query[key] = '0';
      }
    }
  }
  next();
};

/**
 * Add `GET /user/json/:userName/projects` and `GET /user/json/:userName`
 * @param {object} app The express app
 * @param {object} options What the app shares
 * @param {object} options.store The store (makeStore)
 * @param {object} options.broken The rules turned off
 * @param {function(object): string} options.who The visitor of a request, or 'anonymous'
 * @param {function(object, number): Promise<Array<object>>} options.findUsers Users matching a filter, at most n
 * @param {function(object, string, object): object} options.projectForUser The project as the visitor may see it
 * @returns {void}
 */
const addUserRoutes = (app, { store, broken, who, findUsers, projectForUser }) => {
  // read on each request: the variants are turned on and off between runs
  const ignored = () => [
    ...(broken.userIDOnly ? ['collaborators.list.username'] : []),
    ...(broken.noNickname ? ['collaborators.list.nickname'] : [])
  ];
  app.get('/user/json/:userName/projects', rangeVariants(broken), userProjectsRoute({
    db: (req) => storeDb(store, { ignored: ignored(), range: broken.sliceBeforeFilter ? req.query : null }),
    canView: (req, p) => ACS.canViewFiles(p, who(req)),
    // BrainBox's rows: counts of what the visitor may see
    rows: (req, page) => page.map((p) => ({
      project: p.shortname,
      projectName: p.name,
      owner: p.owner,
      numFiles: p.files.list.length,
      numCollaborators: (broken.hiddenCollaboratorsCounted ? p : projectForUser(p, who(req), broken)).collaborators.list.length,
      ...(broken.noModified ? {} : { modified: p.modified })
    })),
    // BrainBox's key; `noListWhenEmpty`: no list for an empty page
    answer: (list) => (broken.noListWhenEmpty && list.length === 0 ? { success: false } : { success: list.length > 0, list })
  }));
  app.get('/user/json/:userName', catchErrors(async (req, res) => {
    const [doc] = await findUsers({ username: req.params.userName }, 1);
    if (!doc) {
      res.status(404).json({ error: 'User not found' });

      return;
    }
    res.json(broken.userDocumentExposed ? doc : publicUser(doc, 'username'));
  }));
};

module.exports = { addUserRoutes };
