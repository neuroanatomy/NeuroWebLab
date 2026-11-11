/**
 * Small HTTP helpers for the tests, on Node's built-in fetch.
 * Replaces `request` and `chai-http` (both unmaintained or ESM-only).
 * The cookie client is in conformance/http.js (the apps use it too).
 */
const { client } = require('../conformance/http');

/**
 * Start an express app on a free port.
 * @param {object} app An express app
 * @returns {Promise<{server: object, url: string}>} The server and its base URL
 */
const listen = (app) => new Promise((resolve, reject) => {
  const server = app.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ server, url: `http://127.0.0.1:${port}` });
  });
  server.on('error', reject);
});

/**
 * Close a server started with `listen`.
 * @param {object} server The server
 * @returns {Promise<void>} Resolves when closed
 */
const close = (server) => new Promise((resolve) => {
  if (!server) {
    resolve();

    return;
  }
  if (server.closeAllConnections) {
    server.closeAllConnections();
  }
  server.close(() => resolve());
});

module.exports = { listen, close, client };
