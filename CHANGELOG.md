# Changelog

## 0.2.0 — 2026-10

Security release (coordination tasks T001, T003, T004). Requires Node 26
(`.nvmrc`, `engines`).

### Breaking changes

- **passport 0.4 → 0.7: the session is regenerated at login and at logout.**
  Anything an app stores in `req.session` before a login is gone after it.
  NeuroWebLab carries `req.session.returnTo` across the login itself (local
  and GitHub), so "log in, then come back to the page you were on" still
  works; any other pre-login session data is dropped. `/logout` now uses
  the asynchronous `req.logout(callback)`; an app that calls
  `req.logout()` or `req.login()` itself must use the callback forms.
- **The session keeps only a small user object.** `req.user` is now
  `{ username, <usernameField>, name?, avatarURL?, url?, joined? }`. It used
  to be the whole GitHub profile (with `_json`, `_raw`, `photos`, …) or, for
  a local login, the whole user document, `passhash` included. Sessions
  stored by earlier versions are read in the new shape (they are reduced
  when deserialized) until the user logs in again.
- **`POST /localSignup` answers differently.** 200 (empty body) only once
  the user is stored; 400 `{error}` for an invalid username (1–40 letters,
  digits, `.`, `_`, `-`, starting with a letter or digit; not `anyone`) or
  password (non-empty, at most 72 bytes); 409 `{error}` when the username
  exists already, in any strategy, ignoring case; 500 `{error}` on a
  database error. It used to answer 200 at once, before the insert, and
  accepted duplicates.
- `searchUsers` / `searchProjects` match `q` literally (regex characters
  are escaped) and refuse a non-string `q`. Callers that escaped `q`
  themselves must stop doing so.
- The GitHub callback no longer writes `brainboxURL` on users, and no
  longer resets `joined` at every login.

### Fixed

- `canRemoveFiles` checked the annotations access instead of the files access.
- `queryAllUsers` is exported; it and `searchUsers` use the configured users
  collection. `queryAllUsers(query, options)` and
  `queryAllProjects(query, options)` pass their options (skip, limit) to the
  database.
- `HasPublicAccess`: a project without an `anyone` entry is not public and
  nothing is logged; other errors log the message only.
- Local login refuses non-string credentials and users without a password
  hash instead of failing with an error.

### Dependencies

- `bcrypt` (native) → `bcryptjs` 3: no native addon left (CentOS 7 servers).
  Hashes written by `bcrypt` still verify. The apps' `overrides.neuroweblab.bcrypt`
  is no longer needed.
- `passport` ^0.7, `express-session` ^1.19, `connect-mongo` ^6 (still on
  monk's client), `lodash` ^4.18; `cross-env` moved to devDependencies.
- `npm audit --omit=dev`: 16 findings (1 critical, 7 high) → 0.
- Tests: mocha 12, no `mock-fs`, `request`, `chai-http` or `nyc`; CI on
  Node 26 from `.nvmrc`, with a canary job on the current Node.

## 0.0.1

Initial version (untagged; last commit c2246d4).
