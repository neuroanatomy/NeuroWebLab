/**
 * Admin access (NeuroWebLab 1.11.0), and the damaged projects tools (1.23.0,
 * damaged.js), and their routes (1.24.0, damagedRoutes.js). Each name is also exported from the root `index.js`.
 */
const { createAdmins, requestUsername } = require('./admins');
const { sendResult, adminLog } = require('./actions');
const { damagedProjects, BATCH_LENGTH, EXAMPLES } = require('./damaged');
const { damagedProjectsRoutes, projectFromBody } = require('./damagedRoutes');

module.exports = {
  createAdmins,
  requestUsername,
  sendResult,
  adminLog,
  // 1.23.0: damaged projects (damaged.js)
  damagedProjects,
  BATCH_LENGTH,
  EXAMPLES,
  // 1.24.0: the damaged projects routes, and the { project, version } body check (damagedRoutes.js)
  damagedProjectsRoutes,
  projectFromBody
};
