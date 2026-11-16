const { consoleLogger } = require('./admins');

/**
 * Answer with the result of an admin action, or its error: `{status, error}`
 * gives that status and { success: false, error }, any other result
 * { success: true, ...result }; a thrown error gives 500 'Server error' and
 * is logged
 * @param {object} res Response object
 * @param {Promise<object>|object} action The action (its promise)
 * @param {object} [options] Options
 * @param {object} [options.logger] Logger with pino's error({ err }, message);
 *   by default console.log('ERROR:', err)
 * @returns {Promise<void>} Resolves once answered
 */
const sendResult = async (res, action, { logger = consoleLogger } = {}) => {
  try {
    const { status, error, ...result } = await action;
    if (error) {
      return res.status(status).json({ success: false, error });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, 'admin request failed');
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

/**
 * Store an admin action in the 'log' collection: { key, value, date }. The
 * entry is returned with its _id, the id an undo refers to. With a logger, a
 * line is written first: logger.info({ event: key, ...fields(value) },
 * 'admin: <key>')
 * @param {object} db Native MongoDB Db
 * @param {string} key The action
 * @param {object} value What it did
 * @param {object} [options] Options
 * @param {object} [options.logger] Logger with info(object, message); none
 *   writes no line
 * @param {function} [options.fields] value => the fields of the line; by
 *   default the value
 * @returns {Promise<object>} The entry, with _id
 */
const adminLog = async (db, key, value, { logger, fields = (v) => v } = {}) => {
  if (logger) {
    logger.info({ event: key, ...fields(value) }, `admin: ${key}`);
  }
  const entry = { key, value, date: (new Date()).toJSON() };
  const { insertedId } = await db.collection('log').insertOne(entry); // the driver also sets entry._id
  if (!entry._id) {
    entry._id = insertedId;
  }

  return entry;
};

module.exports = {
  sendResult,
  adminLog
};
