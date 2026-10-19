const session = require('express-session');
const passport = require('passport');
const { MongoStore } = require('connect-mongo');
const SESSION_SECRET = process.env.SESSION_SECRET || 'a mi no me gusta la sémola';

const github = require('./github');
const local = require('./local');
const { getTokenEndPoint } = require('./token');
const { toSessionUser } = require('./sessionUser');

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

const init = ({ app, db, dirname, usernameField }) => {

  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // NeuroWebLab's native client; same `sessions` collection and documents as before
    store: MongoStore.create({
      client: db.mongoClient(),
      touchAfter: 24 * 3600 // time period in seconds
    })
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  // only the username and public fields go into the session (sessionUser.js);
  // deserializing applies the same reduction to sessions stored before 0.2.0
  passport.serializeUser((user, done) => {
    const sessionUser = toSessionUser(user, usernameField);
    if (!sessionUser) {
      return done(new Error('cannot serialize a user without a username'));
    }
    done(null, sessionUser);
  });

  passport.deserializeUser((stored, done) => {
    // false: no user (the session is treated as logged out)
    done(null, toSessionUser(stored, usernameField) || false);
  });

  // passport >= 0.6: req.logout is asynchronous and regenerates the
  // session, so read returnTo before logging out
  app.get('/logout', function (req, res, next) {
    const { returnTo } = req.session;
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      res.redirect(returnTo || '/');
    });
  });

  // initialise strategies array
  app.set('loginMethods', []);

  // add github login strategy
  github.init({ app, dirname, usernameField });

  // add local login strategy
  if (process.env.LOCALSIGNIN && process.env.LOCALSIGNIN === 'true') {
    local({ app, usernameField });
  }

  // add token auth endpoint
  app.get('/token', getTokenEndPoint);

  /* simple demo */
  app.get('/secure-route-example', ensureAuthenticated, function (req, res) { res.send('access granted'); });

  app.get('/loggedIn', function (req, res) {
    if (req.isAuthenticated()) {
      res.send({ loggedIn: true, username: req.user.username });
    } else {
      res.send({ loggedIn: false });
    }
  });
};

module.exports = {
  init
};
