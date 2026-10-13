/**
 * Small HTTP helpers for the tests, on Node's built-in fetch.
 * Replaces `request` and `chai-http` (both unmaintained or ESM-only).
 */

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

/**
 * A client that keeps the cookies it receives, like a browser.
 * Redirects are not followed, so tests can check them.
 * @param {string} baseURL The server URL
 * @returns {object} A client with `get`, `post` and `cookies`
 */
const client = (baseURL) => {
  const jar = {};

  const encode = (h, { json, form }) => {
    if (typeof json !== 'undefined') {
      h['content-type'] = 'application/json';

      return JSON.stringify(json);
    }
    if (typeof form !== 'undefined') {
      h['content-type'] = 'application/x-www-form-urlencoded';

      return new URLSearchParams(form).toString();
    }

    return null;
  };

  const keepCookies = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
  };

  const send = async (method, path, opts = {}) => {
    const h = { ...(opts.headers || {}) };
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookie) { h.cookie = cookie; }
    const body = encode(h, opts);
    const res = await fetch(baseURL + path, { method, headers: h, body, redirect: 'manual' });
    keepCookies(res);
    const text = await res.text();

    return { status: res.status, headers: res.headers, text, location: res.headers.get('location') };
  };

  return {
    get: (path, opts) => send('GET', path, opts),
    post: (path, opts) => send('POST', path, opts),
    cookies: jar
  };
};

module.exports = { listen, close, client };
