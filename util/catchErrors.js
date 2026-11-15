/**
 * Wraps an async Express handler so that an error it throws answers 500
 * instead of becoming an unhandled rejection (microdraw's `catchErrors`):
 * Express 4 does not catch those, and on Node >= 15 an unhandled rejection
 * ends the process. The error is logged with `req.log` (pino-http) when the
 * app has one, else with `console`.
 */

const jsonServerError = (res) => res.status(500).json({ error: 'Server error' });

/**
 * @param {function} handler An Express handler, (req, res, next), async or not
 * @param {function} [respond] Sends the error answer, given `res`; the default is 500 JSON `{error: 'Server error'}`
 * @returns {function} An async Express handler
 */
const catchErrors = (handler, respond = jsonServerError) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (err) {
    (req.log || console).error({
      err,
      user: req.user && req.user.username
    }, 'unhandled error in route handler');
    if (!res.headersSent) {
      respond(res);
    }
  }
};

module.exports = { catchErrors };
