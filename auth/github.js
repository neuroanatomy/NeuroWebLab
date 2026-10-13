/* eslint-disable no-sync */

const fs = require('fs');
const GithubStrategy = require('passport-github').Strategy;
const passport = require('passport');
const path = require('path');
const { rememberReturnTo, redirectToReturnTo } = require('./returnTo');

let app;
let usernameField;

/** @todo Fix https://github.com/neuroanatomy/NeuroWebLab/issues/1 */

/**
 * Successful GitHub login: store or refresh the user's public profile.
 * `joined` is written only when the user is new (it used to be reset at
 * every login). No `brainboxURL` any more: it was hardcoded as
 * '/user/<name>' in every app's users, and no app reads it.
 * @param {object} req Request, req.user is the GitHub profile
 * @param {object} res Response
 * @param {function} next Next middleware (redirects to returnTo)
 * @returns {void}
 */
const upsertUser = (req, res, next) => {
  const json = req.user._json || {};
  const user = {
    name: req.user.displayName, // github name (optional)
    url: json.blog,
    avatarURL: json.avatar_url // eslint-disable-line camelcase
  };
  user[usernameField] = req.user.username;
  const query = {};
  query[usernameField] = req.user.username;

  app.db.queryUser(query)
    .then(
      () => app.db.updateUser(user),
      (e) => {
        if (e && e.message === 'error find one user') {
          return app.db.addUser({ ...user, joined: (new Date()).toJSON() });
        }
        throw e;
      }
    )
    .then(() => next())
    .catch((e) => {
      console.error('db upsert user error', e && e.message);
      res.status(500).send('could not save the user');
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
      rememberReturnTo,
      passport.authenticate('github', {failureRedirect: '/'}),
      upsertUser,
      redirectToReturnTo()
    );

    // add strategy to list of loginMethods
    const loginMethods = app.get('loginMethods') ? app.get('loginMethods') : [];
    app.set('loginMethods',
      loginMethods.concat({
        url : '/auth/github',
        text : 'Log in with GitHub'
      }));
  } catch (err) {
    console.log('./app/auth/github.js, github-key.json missing or parsing github-keys.json and setting route error', err);
  }
};

module.exports = {
  init
};
