const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const { rememberReturnTo, redirectToReturnTo } = require('./returnTo');
const saltRounds = 10;

/* Local usernames: 1 to 40 characters, letters, digits, '.', '_' and '-',
   starting with a letter or a digit (GitHub's are a subset of these). */
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/* bcrypt only uses the first 72 bytes of a password */
const MAX_PASSWORD_BYTES = 72;
const RESERVED_USERNAMES = ['anyone'];

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Check the body of a sign-up request.
 * @param {object} body The request body
 * @returns {string|null} An error message, or null if the input is valid
 */
const signupInputError = (body) => {
  const { username, password } = body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'username must be 1 to 40 letters, digits, ".", "_" or "-", starting with a letter or a digit';
  }
  if (RESERVED_USERNAMES.includes(username.toLowerCase())) {
    return 'this username is reserved';
  }
  if (typeof password !== 'string' || password.length === 0) {
    return 'password must be a non-empty string';
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `password must be at most ${MAX_PASSWORD_BYTES} bytes`;
  }

  return null;
};

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

module.exports = ({ app, usernameField }) => {

  passport.use(new LocalStrategy(
    (username, password, done) => {
      // a JSON body could send an object such as {"$ne": null} as username
      if (typeof username !== 'string' || typeof password !== 'string') {
        return done(null, false);
      }
      const query = {};
      query[usernameField] = username;
      app.db.queryUser(query)
        .then((user) => {
          // a user without a password hash (GitHub login) can't log in locally
          if (typeof user.passhash !== 'string') {
            return done(null, false);
          }

          // put the same username field in the request object as for github authentication
          user.username = user[usernameField];

          /* bcryptjs reads the $2a$/$2b$ hashes written by the native bcrypt */
          bcrypt.compare(password, user.passhash)
            .then((res) => done(null, res ? user : false))
            .catch((e) => done(e));
        })
        .catch((e) => {
          if (e && e.message === 'error find one user') {
            return done(null, false);
          }
          done(e);
        });
    }
  ));

  app.post(
    '/localLogin',
    rememberReturnTo,
    passport.authenticate('local', {
      failureRedirect: '/html/localsignin.html'
    }),
    redirectToReturnTo(301)
  );

  /**
   * @param {string} username A valid username
   * @returns {Promise<boolean>} Whether a user with that name exists, in any
   *   strategy (local or GitHub), ignoring case
   */
  const usernameTaken = async (username) => {
    const query = {};
    query[usernameField] = { $regex: `^${escapeRegex(username)}$`, $options: 'i' };
    try {
      await app.db.queryUser(query);

      return true;
    } catch (e) {
      if (e && e.message === 'error find one user') {
        return false;
      }
      throw e;
    }
  };

  /*
   * 200: the user is stored (a login can follow at once)
   * 400: invalid username or password
   * 409: the username exists already (local or GitHub user)
   * 500: database error
   */
  app.post('/localSignup', async (req, res) => {
    const inputError = signupInputError(req.body);
    if (inputError) {
      return res.status(400).json({ error: inputError });
    }
    const { username, password } = req.body;
    try {
      if (await usernameTaken(username)) {
        return res.status(409).json({ error: 'username already taken' });
      }

      /* bcryptjs: pure JS, same hashes as the native bcrypt */
      const hash = await bcrypt.hash(password, saltRounds);
      const user = {
        strategy: 'local',
        passhash: hash,
        joined: (new Date()).toJSON()
      };
      user[usernameField] = username;
      await app.db.addUser(user);
      res.status(200).send();
    } catch (e) {
      console.error('/localSignup:', e && e.message);
      res.status(500).json({ error: 'could not create the user' });
    }
  });

  // add strategy to list of loginMethods
  const loginMethods = app.get('loginMethods') ? app.get('loginMethods') : [];
  app.set('loginMethods',
    loginMethods.concat({
      url: '/html/localsignin.html',
      text: 'Log in locally'
    }));
};
