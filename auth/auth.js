const session = require('express-session');
const passport = require('passport');
const MongoStore = require('connect-mongo');
const SESSION_SECRET = process.env.SESSION_SECRET || 'a mi no me gusta la sémola';

const github = require('./github');
const local = require('./local');

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

const init = ({app, MONGO_DB, dirname, usernameField}) => {
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: `mongodb://${MONGO_DB}`,
      touchAfter: 24 * 3600 // time period in seconds
    })
  }));

  app.use(passport.initialize());
  app.use(passport.session());
  passport.serializeUser((user, done) => {
    done(null, user);
  });
  passport.deserializeUser((user, done) => {
    done(null, user);
  });
  app.get('/logout', function (req, res) {
    req.logout();
    res.redirect(req.session.returnTo || '/');
    delete req.session.returnTo;
  });

  // initialise strategies array
  app.set('loginMethods', []);

  // add github login strategy
  github.init({app, dirname, usernameField});

  // add local login strategy
  if(process.env.LOCALSIGNIN && process.env.LOCALSIGNIN === 'true') {
    local({app, usernameField});
  }

  /* simple demo */
  app.get('/secure-route-example', ensureAuthenticated, function (req, res) { res.send("access granted"); });

  app.get('/loggedIn', function (req, res) {
    if (req.isAuthenticated()) {
      res.send({loggedIn: true, username: req.user.username});
    } else {
      res.send({loggedIn: false});
    }
  });
};

module.exports = {
  init
};
