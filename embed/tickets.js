/**
 * WebSocket tickets of the embeddable viewers (NeuroWebLab 1.12.0), from
 * microdraw's app/controller/embed/EmbedAccessService.js and BrainBox's
 * services/EmbedAccessService.js: same collection, lifetime and functions.
 * A ticket's scope is the app's own, stored as given: BrainBox scopes it to
 * an MRI ({dirname, mriSource}), microdraw to a dataset in a project
 * ({source, project}). Each app's WebSocket server reads its own fields.
 */
const crypto = require('crypto');

// Minted fresh on every embed render, never reused across page loads
const WS_TICKET_COLLECTION = 'embedWsTicket';
const WS_TICKET_DURATION = 6 * 3600 * 1000; // 6 h

// [keys, name, options]: microdraw's names and options (app/controller/indexes.js)
const TICKET_INDEXES = [
  [{ token: 1 }, 'token_1', {}],
  [{ expiryDate: 1 }, 'expiryDate_1', { expireAfterSeconds: 0 }]
];

/**
 * Mint a short-lived ticket that an embed page's WebSocket presents to prove
 * that it comes from an embed render.
 * @param {Object} db Native MongoDB Db
 * @param {Object} scope What the ticket is for, stored as given (no field is
 *        renamed or normalised); `username` (who the connection acts as) is
 *        `null` when the scope doesn't give one
 * @returns {Promise<string>} The ticket's token (24 random bytes, hex)
 */
const mintWsTicket = async function (db, scope = {}) {
  const now = new Date();
  const ticket = {
    token: crypto.randomBytes(24).toString('hex'),
    ...scope,
    username: typeof scope.username === 'undefined' ? null : scope.username,
    createdAt: now,
    expiryDate: new Date(now.getTime() + WS_TICKET_DURATION)
  };
  await db.collection(WS_TICKET_COLLECTION).insertOne(ticket);

  return ticket.token;
};

/**
 * Look up a ticket. A missing, empty or non-string token, an unknown or
 * expired ticket, or one without a Date expiry gives null: callers treat that
 * as "no scope", never as "full access".
 * @param {Object} db Native MongoDB Db
 * @param {string} token The token the client presented
 * @returns {Promise<Object|null>} The ticket, or null
 */
const findWsTicket = async function (db, token) {
  if (typeof token !== 'string' || token.length === 0) { return null; }

  const ticket = await db.collection(WS_TICKET_COLLECTION).findOne({ token });
  if (!ticket || !(ticket.expiryDate instanceof Date) || ticket.expiryDate.getTime() < Date.now()) { return null; }

  return ticket;
};

/**
 * Create the tickets' indexes if they are missing: `token_1` on `{token: 1}`,
 * and `expiryDate_1` on `{expiryDate: 1}` with `expireAfterSeconds: 0` (MongoDB
 * removes expired tickets). The names and options are microdraw's, so on its
 * database this is a no-op.
 * @param {Object} db Native MongoDB Db
 * @param {Object} [options] Options
 * @param {Object} [options.logger] Gets `warn({ err, index }, message)` for
 *        each index that can't be created (default `console`)
 * @returns {Promise<void>} Resolves once done; never rejects
 */
const ensureTicketIndex = async function (db, { logger = console } = {}) {
  for (const [keys, name, options] of TICKET_INDEXES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.collection(WS_TICKET_COLLECTION).createIndex(keys, { ...options, name });
    } catch (err) {
      try {
        logger.warn({ err, index: name }, `cannot create the ${WS_TICKET_COLLECTION} index`);
      } catch (logErr) {
        // a broken logger must not make this reject
      }
    }
  }
};

module.exports = {
  WS_TICKET_COLLECTION,
  WS_TICKET_DURATION,
  mintWsTicket,
  findWsTicket,
  ensureTicketIndex
};
