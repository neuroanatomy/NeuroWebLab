/**
 * Admin access (NeuroWebLab 1.11.0), and the damaged projects tools (1.23.0,
 * damaged.js). Each name is also exported from the root `index.js`.
 */
const { createAdmins, requestUsername } = require('./admins');
const { sendResult, adminLog } = require('./actions');
const { damagedProjects, BATCH_LENGTH, EXAMPLES } = require('./damaged');

module.exports = {
  createAdmins,
  requestUsername,
  sendResult,
  adminLog,
  // 1.23.0: damaged projects (damaged.js)
  damagedProjects,
  BATCH_LENGTH,
  EXAMPLES
};
