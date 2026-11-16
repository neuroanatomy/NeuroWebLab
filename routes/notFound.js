/**
 * The 404 catch-all and the error handler (NeuroWebLab 1.13.0), from
 * BrainBox's controller/routes/not-found.js (a211440) and microdraw's
 * app/app.js (notFoundKind, shownPath, its 404 and error handlers).
 * BrainBox's code is the reference: with their defaults, `notFound()` and
 * `errorHandler()` behave as BrainBox's `notFound` and `errorHandler`.
 */
const path = require('path');

/**
 * Whether a request expects JSON: it accepts JSON before HTML, or its path is
 * an API path (/api/…) or a JSON path (…/json/…, …/json)
 * @param {Object} req Express request
 * @returns {boolean} true for a JSON request
 */
const wantsJSON = (req) => req.accepts(['html', 'json']) === 'json'
  || req.path.startsWith('/api/')
  || (/\/json(\/|$)/).test(req.path);

/**
 * Whether a request is for a page: a GET or HEAD that accepts HTML, at a path
 * without a file extension (or .html, .htm). A missing script, image or font
 * is asked with Accept: *\/*, which accepts HTML too: its extension tells it
 * apart.
 * @param {Object} req Express request
 * @returns {boolean} true for a page request
 */
const wantsPage = (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { return false; }
  if (req.accepts(['html', 'json']) !== 'html') { return false; }
  const ext = path.extname(req.path).toLowerCase();

  return ext === '' || ext === '.html' || ext === '.htm';
};

/**
 * The requested path, decoded for display (the template escapes it)
 * @param {Object} req Express request
 * @returns {string} The path; as sent when its escapes are malformed
 */
const displayPath = (req) => {
  try {
    return decodeURIComponent(req.path);
  } catch {
    return req.path;
  }
};

/**
 * The catch-all after the routes: 404 as JSON `{error: 'Not found'}`, as the
 * page `view` (with `message: 'Page not found'` and `path`), or as plain text
 * `Not found`, depending on the request. Nothing is logged: the request
 * logger records the 404 (bots probe a lot of URLs).
 * @param {Object} [options] Options
 * @param {string} [options.view] The view rendered for a page, 'error' by default
 * @returns {function} An Express middleware, (req, res)
 */
const notFound = ({ view = 'error' } = {}) => (req, res) => {
  res.status(404);
  if (wantsJSON(req)) {
    res.json({ error: 'Not found' });
  } else if (wantsPage(req)) {
    res.render(view, { message: 'Page not found', path: displayPath(req) });
  } else {
    res.type('text/plain').send('Not found');
  }
};

/**
 * An error's HTTP status
 * @param {Error} err The error
 * @returns {number} `err.status`, else `err.statusCode`, else 500
 */
const statusOf = (err) => err.status || err.statusCode || 500;

/**
 * BrainBox's log line, for a server error (5xx) only
 * @param {Error} err The error
 * @param {Object} req Express request
 * @returns {void}
 */
const logServerError = (err, req) => {
  if (statusOf(err) >= 500) {
    console.error('ERROR:', req.method, req.originalUrl, err);
  }
};

/**
 * Whether the app runs in development, by default
 * @param {Object} req Express request
 * @returns {boolean} true when the app's env is 'development'
 */
const appInDevelopment = (req) => req.app.get('env') === 'development';

/**
 * The error handler: the error's status (`err.status`, `err.statusCode`, else
 * 500), as JSON `{error: message}` for a JSON request, else as the page `view`
 * with `message` and `error`. Outside development a 5xx message becomes
 * "Server error", and the page gets `error: {status}` instead of the error
 * (no stack). When headers were sent, the error is passed on with `next(err)`.
 * @param {Object} [options] Options
 * @param {string} [options.view] The view rendered for a page, 'error' by default
 * @param {function} [options.isDevelopment] (req) => boolean; by default the app's env is 'development'
 * @param {function} [options.onError] (err, req, res), called for every error before answering;
 *        by default `console.error('ERROR:', req.method, req.originalUrl, err)` for a 5xx only
 * @returns {function} An Express error middleware, (err, req, res, next)
 */
const errorHandler = ({
  view = 'error',
  isDevelopment = appInDevelopment,
  onError = logServerError
} = {}) => (err, req, res, next) => { // eslint-disable-line max-params
  if (res.headersSent) {
    next(err);

    return;
  }
  const status = statusOf(err);
  onError(err, req, res);
  // a server error's message stays on the server, outside development
  const development = isDevelopment(req);
  const message = (status < 500 || development) ? err.message : 'Server error';
  res.status(status);
  if (wantsJSON(req)) {
    res.json({ error: message });
  } else {
    res.render(view, {
      message,
      error: development ? err : { status }
    });
  }
};

module.exports = { wantsJSON, wantsPage, displayPath, notFound, errorHandler };
