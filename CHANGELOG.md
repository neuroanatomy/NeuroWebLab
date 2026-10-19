# Changelog

## 0.3.0 — 2026-10

NeuroWebLab has its own native MongoDB client (coordination ROADMAP Phase 2,
step b). The driver is `mongodb` ~6.21.0, which supports MongoDB servers
4.2 to 8.2 (production runs 4.2). mongodb 7 needs a 4.4 server; moving to it
later should only be a version bump.

### What the apps must do

- **Build `ObjectId`s with NeuroWebLab's driver:**
  `const { ObjectId } = require('neuroweblab');` (also `app.db.ObjectId`).
  The driver refuses BSON values made by another bson major
  (`BSONVersionError`), e.g. an `ObjectId` from an app's own `mongodb` 4.x
  used in a query on `nativeMongoDB()`.
- **`nativeMongoDB()` is now a mongodb 6.21 `Db`** (it was monk's 3.7 one).
  Calls removed from the driver since 3.x fail: `insert` → `insertOne` /
  `insertMany`, `update` → `updateOne` / `updateMany`, `remove` →
  `deleteOne` / `deleteMany`, `count` → `countDocuments`, `find(q, {fields})`
  → `{projection}`; write results have the 4.x+ shape (`insertedId`,
  `matchedCount`, `modifiedCount`, `deletedCount`, no `ops` / `result`).
- **`mongoDB()` (monk) is deprecated** and is removed in 1.0.0. It still
  works unchanged: it now creates a monk instance on the same database on
  its first call (its own connection pool, monk's 3.7 driver) and warns
  once (`DeprecationWarning` `NWL_MONK`). An app that never calls it opens
  no monk connection. Move `db.get(...)` calls to `nativeMongoDB()`.
- **Tests must close NeuroWebLab's connection with `await app.db.close()`**
  (new): it closes the native client and the monk instance if one was
  opened. Closing only the monk instance of `mongoDB()` leaves the native
  client open, and mocha without `--exit` then never ends.

### Unchanged

- `MONGO_DB` is accepted with or without the `mongodb://` scheme.
- The helpers (`queryUser`, `queryProject`, `upsertProject`,
  `findAnnotations`, `updateAnnotations`, `insertAnnotations`, `findToken`,
  …) keep their names, arguments and results: arrays from finds, the
  document or `null`/`undefined` (as before) from single finds, the
  documents from inserts, `{n, nModified, ok}` from updates. As with monk,
  string `_id`s in queries are cast to `ObjectId`, the `fields` option is
  read as `projection`, and `updateAnnotations({options: {multi: true}})`
  updates all matches. One difference: a string `_id` that is not a
  24-character hex id is left as a string (monk threw).
- `deleteProject` resolves `{deletedCount, result: {n, ok}}`; the other
  fields of the 3.7 result (`connection`, …) are gone.
- Sessions: connect-mongo now uses NeuroWebLab's native client; same
  `sessions` collection and documents, so existing sessions stay valid.
- `checkHealth()` now follows the client's state (false while no server is
  reachable, and after `close()`), instead of staying true once connected.

### Dependencies

- `mongodb` ~6.21.0 (new direct dependency; connect-mongo uses the same
  copy). monk ^7.3.4 is kept only for `mongoDB()`.

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
