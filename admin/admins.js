const fs = require('fs');
const path = require('path');
const { jsonForScript } = require('../util/jsonForScript');

/**
 * The logger used when the caller gives none: BrainBox's lines, written with
 * console.log. A logger given by the caller is called as pino is:
 * `logger.warn({ err }, message)`, `logger.error({ err }, message)`
 */
const consoleLogger = {
  warn: ({ err }, message) => console.log(`WARNING: ${message}`, err && err.message),
  error: ({ err }) => console.log('ERROR:', err)
};

/**
 * Username of the user making the request, logged in through a session
 * (GitHub, local sign in) or through a token (authTokenMiddleware sets
 * req.user for a valid token)
 * @param {object} req Request object
 * @returns {string|null} The username, null if nobody is logged in
 */
const requestUsername = (req) => {
  if (req.user && typeof req.user.username === 'string') {
    return req.user.username;
  }

  return null;
};

/**
 * Read the list of admin usernames from a cfg.json (field "admins")
 * @param {string} [cfgPath] Path of the cfg.json; none gives an empty list
 * @param {object} logger Logger with warn({ err }, message)
 * @returns {Array<string>} The admin usernames, empty if none is configured
 */
const readAdmins = (cfgPath, logger) => {
  if (typeof cfgPath !== 'string' || cfgPath === '') {
    return [];
  }
  try {
    // eslint-disable-next-line no-sync
    const cfg = JSON.parse(fs.readFileSync(path.resolve(cfgPath)));

    return Array.isArray(cfg.admins) ? cfg.admins.filter((name) => typeof name === 'string' && name !== '') : [];
  } catch (err) {
    logger.warn({ err }, 'cannot read the admins list from cfg.json');

    return [];
  }
};

/**
 * The login prompt's render fields: an object, or a function of the request
 * @param {object|function} loginPrompt The caller's option
 * @param {object} req Request object
 * @returns {object} The fields
 */
const promptFields = (loginPrompt, req) => (typeof loginPrompt === 'function' ? loginPrompt(req) : loginPrompt) || {};

/**
 * An app's list of admins, read once from its cfg.json, and the functions
 * that check it. Every function returned reads the same list, so that
 * setAdmins (used by the apps' tests) changes what requireAdmin and the
 * admin page see.
 * @param {object} [options] Options
 * @param {string} [options.cfgPath] Path of the app's cfg.json
 * @param {object} [options.logger] Logger with pino's warn({ err }, message);
 *   by default console.log('WARNING: …', err.message)
 * @returns {object} { getAdmins, setAdmins, isAdmin, requestUsername,
 *   requireAdmin, adminPage }
 */
const createAdmins = ({ cfgPath, logger = consoleLogger } = {}) => {
  let admins = readAdmins(cfgPath, logger);

  const getAdmins = () => [...admins];

  /**
   * Replace the list of admins (used by the tests)
   * @param {Array<string>} list Admin usernames
   * @returns {void}
   */
  const setAdmins = (list) => {
    admins = [...list];
  };

  const isAdmin = (username) => typeof username === 'string' && admins.includes(username);

  /**
   * Let through only admins (logged in, or authenticated by a token):
   * 401 JSON without a user, 403 JSON to a non-admin
   * @param {object} req Request object
   * @param {object} res Response object
   * @param {function} next Next middleware
   * @returns {void}
   */
  const requireAdmin = (req, res, next) => {
    const username = requestUsername(req);
    if (!username) {
      return res.status(401).json({ success: false, error: 'User not authenticated' });
    }
    if (!isAdmin(username)) {
      return res.status(403).json({ success: false, error: 'Admins only' });
    }

    next();
  };

  /**
   * The handler of the admin page. Logged out: 401 'askForLogin' (returnTo
   * set) with title, functionality and the caller's loginPrompt fields; not
   * an admin: 403 'error'; an admin: 'admin' with title and loggedUser
   * (jsonForScript of userPayload)
   * @param {object} options Options
   * @param {string} options.title The page title
   * @param {function} [options.userPayload] (req, username) => the logged
   *   user written into the page; by default { username }
   * @param {object|function} [options.loginPrompt] Render fields of the 401
   *   page, or (req) => those fields
   * @returns {function} The Express handler (req, res)
   */
  const adminPage = ({ title, userPayload = (req, username) => ({ username }), loginPrompt = {} } = {}) => (req, res) => {
    const username = requestUsername(req);
    if (!username) {
      req.session.returnTo = req.originalUrl;
      res.status(401).render('askForLogin', {
        title,
        functionality: 'use the admin tools',
        ...promptFields(loginPrompt, req)
      });

      return;
    }
    if (!isAdmin(username)) {
      res.status(403).render('error', { message: 'Admins only' });

      return;
    }
    res.render('admin', {
      title,
      loggedUser: jsonForScript(userPayload(req, username))
    });
  };

  return {
    getAdmins,
    setAdmins,
    isAdmin,
    requestUsername,
    requireAdmin,
    adminPage
  };
};

module.exports = {
  createAdmins,
  requestUsername,
  consoleLogger
};
