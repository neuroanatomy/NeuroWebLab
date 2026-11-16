/**
 * Embed tickets (NeuroWebLab 1.12.0). Each name is also exported from the
 * root `index.js`.
 */
const {
  WS_TICKET_COLLECTION,
  WS_TICKET_DURATION,
  mintWsTicket,
  findWsTicket,
  ensureTicketIndex
} = require('./tickets');

module.exports = {
  WS_TICKET_COLLECTION,
  WS_TICKET_DURATION,
  mintWsTicket,
  findWsTicket,
  ensureTicketIndex
};
