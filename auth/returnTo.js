/**
 * Keep `req.session.returnTo` across a login.
 *
 * From passport 0.6, a successful login regenerates the session (against
 * session fixation), so whatever the app stored in the session before the
 * login is gone afterwards. The apps store the page to come back to in
 * `req.session.returnTo`. `rememberReturnTo` goes before
 * `passport.authenticate` and copies it aside; `redirectToReturnTo` goes
 * after it and redirects there. Only returnTo is carried over, not the rest
 * of the old session (which `keepSessionInfo: true` would copy).
 */

/**
 * @param {object} req Request
 * @param {object} res Response
 * @param {function} next Next middleware
 * @returns {void}
 */
const rememberReturnTo = (req, res, next) => {
  res.locals.returnTo = req.session && req.session.returnTo;
  next();
};

/**
 * @param {number} status Redirect status
 * @returns {function} A middleware redirecting to the remembered page, or /
 */
const redirectToReturnTo = (status = 302) => (req, res) => {
  const returnTo = res.locals.returnTo || req.session.returnTo;
  delete req.session.returnTo;
  res.redirect(status, returnTo || '/');
};

module.exports = { rememberReturnTo, redirectToReturnTo };
