/* eslint-disable no-sync */

const fs = require('fs');
const GithubStrategy = require('passport-github').Strategy;
const passport = require('passport');
const path = require('path');

let app;
let usernameField;

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

const upsertUser = (req, res) => {
  // successfully loged in. Check if user is new

  const user = {
    // username: req.user.username,
    name: req.user.displayName, // github name (optional)
    url: req.user._json.blog,
    brainboxURL: "/user/" + req.user.username,
    avatarURL: req.user._json.avatar_url,
    joined: (new Date()).toJSON()
  };
  user[usernameField] = req.user.username;

  app.db.upsertUser(user)
    .then(() => {
      res.redirect(req.session.returnTo || '/');
      delete req.session.returnTo;
    })
    .catch((e) => {
      console.log('db upsert user error', e);
      res.status(500).send(JSON.stringify(e));
    });
};

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

const init = ({app: newApp, dirname, usernameField: newUsernameField}) => {
  app = newApp;
  usernameField = newUsernameField;

  try {
    const githubKeys = fs.readFileSync( path.join(dirname, 'github-keys.json'), 'utf-8' );
    const githubKeysJson = JSON.parse(githubKeys);

    passport.use(new GithubStrategy(
      githubKeysJson,
      (accessToken, refreshToken, profile, done) => done(null, profile)
    ));

    app.get('/auth/github', passport.authenticate('github'));
    app.get('/auth/github/callback',
      passport.authenticate('github', {failureRedirect: '/'}),
      upsertUser
    );

    // add strategy to list of loginMethods
    const loginMethods = app.get('loginMethods') ? app.get('loginMethods') : [];
    app.set('loginMethods',
      loginMethods.concat({
        url : '/auth/github',
        text : 'Log in with GitHub'
      }));
  } catch (err) {
    console.log("./app/auth/github.js, github-key.json missing or parsing github-keys.json and setting route error", err);
  }
};

module.exports = {
  init
};
