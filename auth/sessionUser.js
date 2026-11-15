/**
 * What NeuroWebLab keeps of a user in the session (and so in `req.user`).
 *
 * Before 0.2.0 the whole object was stored: the GitHub profile (with its
 * `_json` and `_raw` copies of the GitHub API answer) or, for a local login,
 * the whole user document including `passhash`. Now only:
 *
 *   username            the login name; what the apps read (`req.user.username`)
 *   <usernameField>     the same, under the apps' own key (`nickname` in BrainBox)
 *   name, avatarURL,    public profile fields, when known
 *   url, joined
 *
 * `toSessionUser` is used both to serialize and to deserialize, so sessions
 * stored by earlier versions (whole documents) are reduced the same way when
 * they are read back, until those users log in again.
 */

const Configuration = require('../Configuration');

const PUBLIC_FIELDS = ['name', 'avatarURL', 'url', 'joined'];

/**
 * @param {object} user A GitHub profile, a user document, or a session user (old or new shape)
 * @param {string} usernameField The apps' username key ('nickname', 'username')
 * @returns {object|null} The session user, or null if `user` has no username
 */
const toSessionUser = (user, usernameField) => {
  if (!user || typeof user !== 'object') {
    return null;
  }
  const username = user.username || user[usernameField];
  if (typeof username !== 'string' || username.length === 0) {
    return null;
  }
  const json = user._json || {};
  const candidates = {
    name: user.name || user.displayName,
    avatarURL: user.avatarURL || json.avatar_url, // eslint-disable-line camelcase
    url: user.url || json.blog,
    joined: user.joined
  };
  const out = { username };
  out[usernameField] = username;
  for (const field of PUBLIC_FIELDS) {
    if (typeof candidates[field] === 'string' && candidates[field].length > 0) {
      out[field] = candidates[field];
    }
  }

  return out;
};

/**
 * The username of the session a cookie belongs to: who opened a WebSocket
 * connection, from the session cookie the browser sent with the upgrade
 * request (microdraw's `sessionUser.js`, the cookie part of BrainBox's
 * `atlas-write-access.js`). Never the username a client puts in its messages.
 * The session user is read under `username` or, for sessions stored by
 * earlier versions (whole documents), the configured `usernameField`.
 * @param {function} sessionParser The app's session middleware (express-session)
 * @param {string} cookie The Cookie header sent when the socket was opened
 * @returns {Promise<string|null>} The username, or null for a logged-out visitor
 */
const usernameFromCookie = (sessionParser, cookie) => new Promise((resolve) => {
  if (typeof sessionParser !== 'function' || typeof cookie !== 'string' || cookie.length === 0) {
    resolve(null);

    return;
  }
  // a fresh request each time, so that a logout or an expired session counts
  const req = { headers: { cookie }, url: '/', originalUrl: '/' };
  try {
    sessionParser(req, {}, (err) => {
      const user = !err && req.session && req.session.passport && req.session.passport.user;
      const { usernameField } = Configuration.getInstance();
      const username = user && typeof user === 'object' && (user.username || user[usernameField]);
      resolve(typeof username === 'string' && username.length > 0 ? username : null);
    });
  } catch (err) {
    resolve(null);
  }
});

module.exports = { toSessionUser, usernameFromCookie, PUBLIC_FIELDS };
