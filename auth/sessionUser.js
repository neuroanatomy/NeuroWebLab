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

module.exports = { toSessionUser, PUBLIC_FIELDS };
