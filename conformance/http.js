/**
 * A cookie client on Node's built-in fetch, for the conformance suite and
 * NeuroWebLab's own tests (moved from test/http.js in 1.1.0).
 */

/**
 * A client that keeps the cookies it receives, like a browser.
 * Redirects are not followed, so tests can check them.
 * @param {string} baseURL The server URL
 * @returns {object} A client with `get`, `post`, `delete` and `cookies`
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
    delete: (path, opts) => send('DELETE', path, opts),
    cookies: jar
  };
};

module.exports = { client };
