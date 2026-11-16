/**
 * Admin access (NeuroWebLab 1.11.0). Each name is also exported from the
 * root `index.js`.
 */
const { createAdmins, requestUsername } = require('./admins');
const { sendResult, adminLog } = require('./actions');

module.exports = {
  createAdmins,
  requestUsername,
  sendResult,
  adminLog
};
