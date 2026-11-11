# Changelog

## 1.3.0 — 2026-11

### New

- **`conformance`: slice 3, `projectListings(adapter)`: listings and search**
  (30 cases and the final check). The rules are the ones the maintainer
  approved on 2026-11-11 (coordination `tasks/proposed-shared-pm-tests.md`,
  "Slice 3: rules for the differing rows"), each case tagged with its row:
  `?page` lists only what the visitor may view (3.1), filtered then paged,
  20 per page, no project twice (3.2, over 41 projects, the hidden ones mixed
  in); a user's projects: owned or a row by `userID` or `username`, then
  `files: view` (3.3), `start`/`length` optional, filtered then sliced (3.4),
  rows with `numFiles`, `numCollaborators` of the visible rows, `modified`,
  an empty list (3.5); project search: only viewable projects, the first 10,
  `{shortname, name}` (3.6); user search: username or name, at most 10, no
  email or other private field (3.7); search text literal, a non-string
  `q` refused 400 (3.8). Not in the slice: 3.9, 3.10 (app-specific).
- New default routes: `userProjectsAll`, `userProjectsRange`,
  `searchProjects` (`/search/json/projects?q=:q`; BrainBox has no project
  search: its adapter sets it to `null`, and the 3.6 cases are skipped),
  `searchUsers` (`/api/userNameQuery?q=:q`).
- New optional adapter fields, used by slice 3 only: `setUserFields(username,
  fields)` (a name and an email, 3.7) and `rows` (`list`, `userProjects`,
  `searchProjects`, `searchUsers`: the answer's rows in the suite's shape;
  the defaults read both apps' shapes).

### Changed

- `db.searchUsers` matches the name too, not only the username (as
  BrainBox's user search; shared suite row 3.7). It still sends the
  username and name only, at most 10.
- The reference app (`test/conformanceApp.js`) gains the listing and search
  routes of the approved rules; 11 broken variants show each slice 3 rule
  can fail (page before filtering, private projects in search, hidden
  collaborators counted, an email in user search, …).

### What the apps must do

Nothing, until they move the pin to `#v1.3.0`. Then: call
`projectListings(adapter)` after the other two, add `setUserFields`, set
`routes` where they differ (BrainBox: `searchProjects: null`; microdraw:
`searchUsers`), and declare the rows they still differ on.

## 1.2.0 — 2026-11

### New

- **`conformance`: slice 2, `projectLifecycle(adapter)`: create, save,
  delete, validation, versions** (39 cases and the final check). The rules
  are the ones the maintainer approved on 2026-11-11 (coordination
  `tasks/proposed-shared-pm-tests.md`, "Slice 2: rules for the differing
  rows"), each case tagged with its row: save logged out 401 (2.1), edit
  rights on the stored version (2.2), list lengths (2.3) and rows changed in
  place (2.4), the owner never the client's (2.5), shortname = URL and
  `[a-zA-Z0-9-]` (2.6), `anyone` row (2.7), exact access values (2.8), users
  that must exist (2.9), layers (2.10), sanitising per string (2.12), invalid
  document 400 `{error}` (2.13), stored and blank rows (2.14), client `_id`
  and `backup` ignored (2.15), a version per save (2.16), stored fields kept
  (2.17), `modified`/`modifiedBy` (2.18), current reads (2.19), two saves at
  once (2.20), delete refused (2.22), unknown (2.23), what is left (2.24),
  a shortname reused (2.25). See `conformance/README.md`.
- New optional adapter fields, used by slice 2 only: `versions(shortname)`,
  `annotations.add` / `annotations.readable`, `fileList(project)`. A case
  that needs a missing one fails naming it (`adapter.versions is needed`).
  Slice 2 removes a user (2.9): the adapter's `removeUser` must really do it.
- One adapter serves both slices: `RULES` lists every slice's rules.

### Changed

- **Slice 1's `2.1/status` now asserts 401** (save logged out), the approved
  rule, instead of BrainBox's 403. An app answering 403 declares
  `2.1/status`; one answering 401 removes it from its list.
- The reference app (`test/conformanceApp.js`) keeps versions and follows
  the approved slice 2 rules (`test/conformanceSave.js`); 23 broken variants
  show each slice 2 rule can fail.

### What the apps must do

Nothing, until they move the pin to `#v1.2.0`. Then: call
`projectLifecycle(adapter)` next to `accessMatrix(adapter)`, add `versions`
and `annotations` to the adapter, and update `expectedDifferences` (the
adapters in the coordination folder, `tasks/shared-pm-tests-adapters/`).

## 1.1.1 — 2026-11

### Fixed

- `conformance`: the setup that signs up and logs in the suite's users (bcrypt)
  has a budget of 1 s per user, so it no longer exceeds mocha's default 2 s on
  slower machines (CI failed on 1.1.0). The tests keep the app's timeout.

## 1.1.0 — 2026-11

### New

- **`neuroweblab/conformance`: the shared project-management suite, slice 1
  (access matrix).** `accessMatrix(adapter)` defines mocha tests that an app
  runs inside its own test command, against the server its setup started,
  over HTTP: owner, collaborator at each level, `anyone` at each level,
  non-member, anonymous and token user × project page, settings, JSON,
  `/files`, POST, DELETE, `?page` listing, user projects, plus unknown
  projects, the new-project page, `modifiedBy` and unknown tokens (450 tests).
  The rules are BrainBox's; an app declares where it still differs
  (`expectedDifferences`), and those cases are reported as pending. See
  `conformance/README.md`.
- The cookie client of `test/http.js` moved to `conformance/http.js` (now with
  `delete`); `test/http.js` re-exports it.

### What the apps must do

Nothing. Adopting the suite is a test-only change (one test file, the adapter).

## 1.0.0 — 2026-11

### Breaking

- **`mongoDB()` (monk) is removed.** Use `nativeMongoDB()`, NeuroWebLab's
  native mongodb 6.21 `Db` (deprecated since 0.3.0). `db.mongoDB` is now
  `undefined`: an app that still calls it fails with "db.mongoDB is not a
  function".
- **monk is no longer a dependency** (nor its mongodb 3.7 driver and their
  own dependencies). `close()` closes the native client only.

### What the apps must do

Nothing, if they no longer call `mongoDB()`: check with
`git grep "mongoDB()"` in the app. Otherwise, move `db.mongoDB().get(...)`
calls to `nativeMongoDB().collection(...)` (see 0.3.0 for the native
driver's API) before moving the pin to `#v1.0.0`.

### MongoDB servers

- 2026-11: production runs MongoDB 8.0 since the server move (the 0.3.0
  note said 4.2); CI runs 8.2 (8.0 does not start on kernels ≥ 6.19).
- The driver stays `mongodb` ~6.21.0. Moving to mongodb 7 (servers ≥ 4.4)
  is now possible and is left for a later release.

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
