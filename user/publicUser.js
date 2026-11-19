/**
 * What of a user others may see (NeuroWebLab 1.22.0, stage 4 merge M15a),
 * from BrainBox's controller/user/publicUser.js (the reference: own
 * properties only, never a throw) and microdraw's
 * app/controller/user/user.controller.js (`publicUserFields`, `publicUser`).
 *
 * An allow-list, not a deny-list: only the username field and the fields of
 * `PUBLIC_USER_FIELDS` leave the server. `passhash`, tokens, `email`,
 * `strategy` and any field added to the users collection later stay
 * private until they are listed here.
 */
const Configuration = require('../Configuration');

/**
 * The public fields besides the username field: `name`, `avatarURL`, `url`
 * and `joined` (the user page, nwl-components' UserPage)
 */
const PUBLIC_USER_FIELDS = Object.freeze(['name', 'avatarURL', 'url', 'joined']);

/**
 * A user as others may see it: the username field and the fields of
 * `PUBLIC_USER_FIELDS`, only those `doc` has as its own properties (a stored
 * `null` is kept; an own `undefined` too, which `res.json` and
 * `jsonForScript` drop, as microdraw's `!== undefined` did; an inherited
 * field is not kept)
 * @param {object} doc A user document, or a session user
 * @param {string} [usernameField] The username's key (BrainBox `nickname`,
 *   microdraw `username`); default the configured `usernameField`
 * @returns {object} A new object; `{}` for a non-object
 */
const publicUser = (doc, usernameField = Configuration.getInstance().usernameField) => {
  const result = {};
  if (doc === null || typeof doc !== 'object') {
    return result;
  }
  const fields = typeof usernameField === 'string' ? [usernameField, ...PUBLIC_USER_FIELDS] : PUBLIC_USER_FIELDS;
  for (const field of fields) {
    if (Object.hasOwn(doc, field)) {
      result[field] = doc[field];
    }
  }

  return result;
};

/**
 * The logged user as the pages may see it (BrainBox's): `publicUser` plus
 * `username` (read by the nwl-components header). The session user is
 * already reduced (auth/sessionUser.js); the allow-list stays, so that no
 * other field can reach a page.
 * @param {object} reqUser `req.user`
 * @param {string} [usernameField] As `publicUser`
 * @returns {object|null} null when nobody is logged in
 */
const publicLoggedUser = (reqUser, usernameField = Configuration.getInstance().usernameField) => {
  if (!reqUser || typeof reqUser !== 'object') {
    return null;
  }

  return { ...publicUser(reqUser, usernameField), username: reqUser.username };
};

module.exports = { PUBLIC_USER_FIELDS, publicUser, publicLoggedUser };
