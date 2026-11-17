# Changelog

## 1.14.0 — 2026-11

### New

- **What a visitor may see of a project, exported from
  `require('neuroweblab')`** (stage 4, merge M7), in `project/visible.js`.
  microdraw's `visibleProjectParts` (app/controller/project/visibleProject.js)
  and BrainBox's `projectForUser` (controller/project/project.controller.js)
  are the reference; it is the union of their rules.
  - `visibleProject(project, user)`: a new object; `project` is never changed
    (the lists are new arrays in new list objects, other fields are copied
    shallowly). A missing or malformed `collaborators`, `files` or
    `annotations` list object becomes `{...the object, list: []}`. Both
    permissions are decided on the unchanged project. Collaborators the
    visitor can't view: only the `anyone` row is kept and `modifiedBy` is
    deleted. Annotations or files the visitor can't view: the list is emptied.
    `user` is a username or a logged-out sentinel (`'anyone'`, `'anonymous'`,
    `null`).
  - `isAnyoneRow(row)`: a plain object whose `username` or `userID` is
    `'anyone'`.
  - `collaboratorKey(row)`: for a plain object, the first non-empty string
    among `userID`, `nickname`, `username` (BrainBox's order); else
    `undefined`. BrainBox's `collaboratorUser` returns a non-object row as it
    is and takes any truthy value; microdraw's `collaboratorName` reads
    `username` first and never `nickname`.
- **Two statics on `AccessControlService`:**
  - `isLoggedOut(user)`: true for a non-string, `''`, `'anonymous'` or
    `'anyone'` (BrainBox's rule plus microdraw's sentinel). BrainBox's
    subclass defines its own `isLoggedOut` (without `'anyone'`), which still
    hides this one for the subclass.
  - `getEffectiveAccessLevel(project, user, accessType)`: BrainBox's
    `getUserOrPublicAccessLevel` override. The higher of the user's own level
    and the `anyone` row's (shared suite 4.2); for annotations, a logged-out
    visitor gets at most `view` (shared suite 4.4). It throws as
    `getUserOrPublicAccessLevel` does when the project has neither row.
- `getUserOrPublicAccessLevel` is unchanged.
- Unit specs in `project/visible.spec.js` and
  `accessControl/effectiveAccessLevel.spec.js` (BrainBox's
  `anyone-floor.spec.js` and `logged-out-annotations.spec.js` level cases,
  ported); `test/exports.spec.js` checks the new names.
- Nothing is renamed or removed; every 1.13.0 export is unchanged.

### What the apps must do

Nothing is required. When each app switches, it will see:

**microdraw** (M7b):

- `visibleProject` returns a copy instead of changing the project in place:
  callers must use the return value.
- In `embed/embed-access.js` `annotationsAccess`, with
  `getEffectiveAccessLevel`: a logged-out visitor on a project whose `anyone`
  row gives annotations `edit` now reads `view`, and a collaborator whose own
  row is lower than `anyone`'s now reads `anyone`'s level.
- `collaboratorKey` reads `userID` before `username` (microdraw's rows have
  them equal).

**BrainBox** (M7c):

- The `anyone` row is found by `username` too, not only `userID`.
- Missing lists no longer throw.
- `'anyone'` counts as logged out (with `AccessControlService.isLoggedOut`).
- The `getUserOrPublicAccessLevel` override can call
  `getEffectiveAccessLevel`, and `collaboratorUser` can use `collaboratorKey`
  (a non-object row then gives `undefined`).

## 1.13.0 — 2026-11

### New

- **The 404 catch-all and the error handler, exported from
  `require('neuroweblab')`** (stage 4, merge M6), in `routes/notFound.js`.
  BrainBox's `controller/routes/not-found.js` (a211440) is the reference;
  microdraw's `notFoundKind`, `shownPath` and its two handlers in
  `app/app.js` do the same with small differences (below).
  - `wantsJSON(req)`: the request accepts JSON before HTML, or its path is
    under `/api/`, or matches `/\/json(\/|$)/` (`…/json/…` and `…/json`).
  - `wantsPage(req)`: a GET or HEAD that accepts HTML, at a path without an
    extension, or `.html`, `.htm`.
  - `displayPath(req)`: the decoded path, or the path as sent when an escape
    is malformed.
  - `notFound({ view = 'error' })`: a factory; the catch-all answers 404 as
    JSON `{error: 'Not found'}`, as the page `view` with `message: 'Page not
    found'` and `path`, or as plain text `Not found`. Nothing is logged.
  - `errorHandler({ view = 'error', isDevelopment, onError })`: a factory;
    BrainBox's handler. Headers sent: `next(err)`. The status is
    `err.status || err.statusCode || 500`. A 5xx message is "Server error"
    outside development (`isDevelopment(req)`, by default the app's env is
    `'development'`). JSON `{error: message}` for a `wantsJSON` request, else
    the page `view` with `message` and `error` (the error in development,
    `{status}` outside it). `onError(err, req, res)` is called for every
    error before answering (not when headers were sent); the default is
    BrainBox's `console.error('ERROR:', req.method, req.originalUrl, err)`,
    for a 5xx only.
- Unit specs in `routes/notFound.spec.js` (a small Express app on Node's
  fetch, a view that answers its locals); `test/exports.spec.js` checks the
  new names.
- Nothing is renamed or removed; every 1.12.0 export is unchanged.

### What the apps must do

Nothing is required. The apps may replace their copies (M6b microdraw, M6c
BrainBox).

**BrainBox** (M6c), no change in behaviour:

```js
const { notFound, errorHandler } = require('neuroweblab');

app.use(notFound());
app.use(errorHandler());
```

and `controller/routes/not-found.js` can go.

**microdraw** (M6b): `notFoundKind`, `shownPath` and the two handlers go;

```js
const { notFound, errorHandler } = require('neuroweblab');

app.use(notFound());
// logged with the request line (pino-http reads res.err), for every status
app.use(errorHandler({ onError: (err, req, res) => { res.err = err; } }));
```

What microdraw will see change:
- `…/json` at the end of a path, with no slash after it, is answered as
  JSON (it was HTML or text).
- Errors from JSON requests are answered as JSON (they were always the HTML
  page).
- A 5xx message is hidden outside development (it was always shown).
- The error page gets `error: {status}` outside development (it was `{}`),
  so `{{error.status}}` now shows the status number.
- Headers already sent: the error is passed on (it was rendering again).

## 1.12.0 — 2026-11

### New

- **Embed tickets and the Embed Project route, exported from
  `require('neuroweblab')`** (stage 4, merge M5). The apps' code (microdraw
  7fc4ea3 `app/controller/embed/EmbedAccessService.js`, its two indexes in
  `app/controller/indexes.js` and `projectEmbed` in `embed.controller.js`;
  BrainBox 63cf121 `services/EmbedAccessService.js` and
  `controller/project/project-embed.js`), in `embed/` and `routes/`:
  - `WS_TICKET_COLLECTION` (`'embedWsTicket'`) and `WS_TICKET_DURATION`
    (6 h): the same in both apps.
  - `mintWsTicket(db, scope)`: stores `{ token, ...scope, username,
    createdAt, expiryDate }` and returns the token (24 random bytes, hex).
    The scope is stored as given, no field renamed or normalised: BrainBox's
    `{ dirname, mriSource, username }`, microdraw's `{ source, project,
    username }`. `username` is `null` when the scope doesn't give one.
  - `findWsTicket(db, token)`: the ticket, or `null` for a non-string or
    empty token, an unknown or expired ticket, or a ticket without a `Date`
    `expiryDate` (microdraw's checks).
  - `ensureTicketIndex(db, { logger })`: creates `token_1` on `{ token: 1 }`
    and `expiryDate_1` on `{ expiryDate: 1 }` with `expireAfterSeconds: 0`,
    microdraw's names and options, so on microdraw's database it is a no-op.
    It never rejects: an index that fails gives
    `logger.warn({ err, index }, 'cannot create the embedWsTicket index')`
    (default `console`).
  - `projectEmbedRoute(adapter)`: the Express handler of
    `GET /project/:projectName/embed`. It sets
    `Content-Security-Policy: frame-ancestors *`; then
    `adapter.findProject(req, shortname)` (none: 404 `This project could not
    be found.`); the first file (none: 404 `adapter.noFilesMessage`);
    `adapter.mayEmbed(req, { source, project })` → `{ status, message }`
    (not 200: that answer); else 302 to `adapter.embedURL(source,
    project.shortname)`. Errors are rendered by
    `adapter.embedError(res, status, message)`. A thrown error is logged with
    `req.log` or `console` (as `catchErrors`) and answers 500
    `adapter.serverErrorMessage`, unless headers were sent.
  - `firstSource(project)`: the first non-empty string of `files.list`
    (strings or `{ source }` objects), else `null`.
- Unit specs in `embed/tickets.spec.js` (against the test MongoDB) and
  `routes/projectEmbed.spec.js`; `test/exports.spec.js` checks the new names.
  The apps' route tests (microdraw `embed.spec.js`, BrainBox `embed.test.js`
  E14) stay in the apps.
- Nothing is renamed or removed; every 1.11.0 export is unchanged.

### What the apps must do

Nothing is required. The apps may replace their copies (M5b microdraw, M5c
BrainBox).

**microdraw** (M5b):
- `EmbedAccessService.js` re-exports NWL's functions. Its
  `project: project || null` moves to its caller, `dataEmbed`:
  `mintWsTicket(db, { source, project: decision.project ? decision.project.shortname : null, username })`
  already passes `null` for no project, so nothing changes in the tickets.
- `ensureIndexes` may keep its two `embedWsTicket` rows, or call
  `ensureTicketIndex(db, { logger: log })`: same indexes.
- `projectEmbed` becomes:

```js
const { projectEmbedRoute } = require('neuroweblab');

projectEmbed: projectEmbedRoute({
  findProject: (req, shortname) => findCurrentProject(req.app.db.nativeMongoDB(), shortname),
  mayEmbed: (req, { source, project }) => mayEmbedData(req.app.db.nativeMongoDB(), {
    source, project: project.shortname, username: usernameOf(req)
  }),
  embedURL: (source, project) => `/data/embed?${new URLSearchParams({ source, project })}`,
  embedError,
  noFilesMessage: 'This project has no dataset.',
  serverErrorMessage: 'This dataset could not be loaded.'
})
```

**BrainBox** (M5c):
- `services/EmbedAccessService.js` stays an object that re-exports NWL's
  functions (a spec stubs `findWsTicket` on it with sinon).
- Call `ensureTicketIndex(nativeDb)` at start-up: BrainBox has no index on
  `embedWsTicket` yet, so expired tickets start being removed by MongoDB.
- `findWsTicket` is stricter: a truthy non-string token (an array or object
  from a parsed query) was looked up before, and now gives `null`; so does a
  ticket without a `Date` expiry.
- `projectEmbed` becomes:

```js
const { projectEmbedRoute } = require('neuroweblab');

const noBrain = { status: 404, message: 'This project has no brain to show.' };

const projectEmbed = projectEmbedRoute({
  findProject: (req, shortname) => req.nativeDb.collection('project')
    .findOne({ shortname, backup: { $exists: false } }, { projection: { _id: 0 } }),
  mayEmbed: async (req, { source }) => {
    const json = await req.nativeDb.collection('mri')
      .findOne({ source, backup: { $exists: false } }, { projection: { _id: 0 } });
    if (!json) { return noBrain; }
    const projects = await getRelatedProjects(req.nativeDb, json, source);
    const loggedUser = req.isAuthenticated() ? req.user.username : 'anonymous';

    return mayEmbedMri(json, projects, loggedUser) ? { status: 200 } : { status: 403, message: 'This content is private.' };
  },
  embedURL: (url, project) => `/mri/embed?${new URLSearchParams({ url, project })}`,
  embedError,
  noFilesMessage: noBrain.message,
  serverErrorMessage: 'This project could not be shown.'
});
```

  The answers are BrainBox's: no project 404, no file or no MRI document
  404 `This project has no brain to show.`, private 403, else 302. Only the
  log line of a thrown error changes (`req.log || console`.error, as
  `catchErrors`, instead of `console.log('ERROR projectEmbed:', err)`), and a
  thrown error after headers were sent no longer tries a second answer.

## 1.11.0 — 2026-11

### New

- **Admin access, exported from `require('neuroweblab')`** (stage 4, merge
  M4). The apps' code (microdraw 6bacd20 `app/controller/admin/admins.js`,
  `admin.controller.js` and the four `log` helpers; BrainBox 362fc3e
  `controller/admin/admins.js`, `admin.controller.js` and the inline `log`
  inserts), in `admin/`:
  - `createAdmins({ cfgPath, logger })`: an app's admins list, read once
    from the `admins` field of `cfgPath` (non-empty strings kept; a missing
    file or bad JSON gives `[]` and a warning; no `cfgPath` gives `[]`). It
    returns `{ getAdmins, setAdmins, isAdmin, requestUsername, requireAdmin,
    adminPage }`, all reading the same list, so `setAdmins` in an app's tests
    changes what its `requireAdmin` and admin page see. Each call makes its
    own list. `logger` is called as pino is
    (`logger.warn({ err }, 'cannot read the admins list from cfg.json')`,
    microdraw's line); without one the warning is BrainBox's
    `console.log('WARNING: cannot read the admins list from cfg.json',
    err.message)`.
  - `requireAdmin(req, res, next)`: 401 `User not authenticated`, 403
    `Admins only` (JSON), else `next()` (both apps' code).
  - `adminPage({ title, userPayload, loginPrompt })`: the page's handler.
    Logged out: `returnTo` set, 401 `askForLogin` with `title`,
    `functionality: 'use the admin tools'` and the `loginPrompt` fields (an
    object, or `(req) => fields`). Not an admin: 403 `error`. An admin:
    `admin` with `title` and `loggedUser: jsonForScript(userPayload(req,
    username))` (default `{ username }`).
  - `requestUsername(req)`: `req.user.username` (session or token), else
    `null`; also on each instance.
  - `sendResult(res, action, { logger })`: `{status, error}` → that status
    and `{success: false, error}`, a result → `{success: true, ...result}`,
    a thrown error → 500 `Server error`, logged with
    `logger.error({ err }, 'admin request failed')` (microdraw's line) or,
    without a logger, `console.log('ERROR:', err)` (BrainBox's).
  - `adminLog(db, key, value, { logger, fields })`: inserts
    `{ key, value, date }` in `log` and returns the entry with its `_id` (the
    id an undo refers to). With a `logger`, first writes
    `logger.info({ event: key, ...fields(value) }, 'admin: <key>')`
    (`fields` defaults to the value); without one, no line.
- Unit specs in `admin/admins.spec.js` and `admin/actions.spec.js`;
  `test/exports.spec.js` checks the new names. Shared suite 5.1, 5.2 and 5.4
  unchanged.
- Nothing is renamed or removed; every 1.10.0 export is unchanged.

### What the apps must do

Nothing is required: no suite case changed. The apps may replace their
copies (M4b microdraw, M4c BrainBox). An app's `admins.js` becomes:

```js
// microdraw app/controller/admin/admins.js
const path = require('path');
const { createAdmins } = require('neuroweblab');
const logger = require('../../log');

module.exports = createAdmins({
  cfgPath: process.env.CFG_PATH || path.join(__dirname, '../../../cfg.json'),
  logger
});
```

```js
// BrainBox controller/admin/admins.js
const path = require('path');
const { createAdmins } = require('neuroweblab');

module.exports = createAdmins({ cfgPath: path.resolve(__dirname, '../../cfg.json') });
```

Then, in `admin.controller.js`:
- `requireAdmin` is the instance's (`require('./admins').requireAdmin`).
- `adminPage` is `admins.adminPage({ ... })`. microdraw:
  `{ title: 'MicroDraw: Admin', loginPrompt: { login: "<a href='/auth/github'>Log in with GitHub</a>" } }`
  (`userPayload` default). BrainBox: `{ title: 'BrainBox: Admin',
  userPayload: (req) => publicLoggedUser(req.user), loginPrompt: (req) =>
  ({ loggedUser: jsonForScript(publicLoggedUser(req.user)) }) }`.
- `sendResult(res, action, { logger })` (microdraw) and
  `sendResult(res, fix)` for BrainBox's `sendFixResult`.
- microdraw's `log` helpers: `adminLog(db, key, value, { logger, fields })`
  with `fields: (v) => _.omit(v, ['project'])` (`admin.projects.js`,
  `admin.damaged.js`) or `fields: ({ ids, ...rest }) => (ids ? { ...rest,
  documents: ids.length } : rest)` (`admin.datasets.js`,
  `admin.annotations.js`). BrainBox's inline inserts: `adminLog(nativeDb,
  key, value)` (no line, as now; the entry now comes back with its id).

## 1.10.0 — 2026-11

### New

- **Validation helpers for project documents, exported from
  `require('neuroweblab')`** (stage 4, merge M3). The apps' code (microdraw
  7d93f81 `project.validation.js` and `project.controller.js`, BrainBox
  1f767da `project.controller.js` and `project-rows.js`), in
  `project/rules.js`:
  - `plainText(str)`: markup removed by DOMPurify, text kept; a string
    without `<` is kept as it is (both apps). The DOMPurify instance, over a
    jsdom window that loads nothing and runs no script, is created once per
    process, on the first string that needs it.
  - `sanitize(value)`: a copy of a JSON value with every string through
    `plainText`; arrays and plain objects are copied, other values returned
    as they are (microdraw's `sanitize`, BrainBox's `sanitizeValue`: the
    same code).
  - `isBlank(v)`, `text(v)`, `listOf(project, type)`: both apps' code.
    `project/save.js` now uses this `listOf` (the same code it had).
  - `isBlankRow`: blank rows by list. A collaborator row is blank if it has
    no `username`, `userID` or `nickname` (BrainBox's; microdraw's did not
    read `nickname`).
  - `sortRows(type, rows, oldRows, {rowKey, isBlankRow})`: the stored, new
    and blank rows of one list (shared suite 2.14). What a row is compared
    on differs between the apps, so `rowKey` (by list) is the app's and is
    required; `isBlankRow` defaults to the one above. The stored rows are
    compared as given: the caller sanitises them as the rows sent
    (BrainBox's form; microdraw's sanitised each stored row itself).
  - `shortnamePattern`: `/^[a-zA-Z0-9-]+$/`, a new project's shortname
    (both apps).
  - `droppedMessage(dropped)`: `' Empty rows were not saved (1 files, 2
    annotations).'`, with its leading space, or `''`; `dropped` may be
    missing (BrainBox's). `ignoredChangesMessage` is unchanged.
- Unit specs in `project/rules.spec.js` (the apps' `plainText` and
  shortname cases, and new ones); `test/exports.spec.js` checks the new
  names.
- Nothing is renamed or removed; every 1.9.0 export is unchanged.

### Dependencies

- `dompurify` `^3.4.16` and `jsdom` `^16.5.0`, the apps' ranges, so that
  each app keeps one copy of each. jsdom 16 runs on Node 26 with no
  deprecation warning.

### What the apps must do

Nothing is required: no suite case changed. The apps may replace their
copies with the helpers (M3b microdraw, M3c BrainBox):
- microdraw: `plainText`, `sanitize`, `isBlank`, `text`, `listOf`,
  `shortnamePattern` and `droppedMessage`; `sortRows` called with its own
  `rowKey`, `listOf(oldProject, type).map(sanitize)` as `oldRows`, and, to
  keep a collaborator row named by `nickname` alone blank (dropped) rather
  than refused, an `isBlankRow` whose `collaborators` reads `username` and
  `userID` only.
- BrainBox: `plainText`; `sanitizeValue` becomes `sanitize`; `isBlank`,
  `text`, `listOf`, `isBlankRow`, `shortnamePattern`, `droppedMessage`;
  `sortRows` called with its `rowKey` (which stays in `project-rows.js`
  with `collaboratorUser` and `fileSource` until M7 / D2).
- Each app may then drop its own `dompurify` and `jsdom` dependencies only
  if nothing else in it uses them.

## 1.9.0 — 2026-11

### New

- **Save rights for a project's own fields, and the incomplete files list
  guard, exported from `require('neuroweblab')`** (stage 4, merge M2). The
  apps' code, the same in both since 2026-11-15 (microdraw a3dd277,
  BrainBox e97e408), in `project/save.js`:
  - `canSaveProject(oldProject, user)`: whether a user may save an existing
    project: `edit` on at least one of its lists (both apps).
  - `keepFieldsWithoutFilesEdit(newProject, oldProject, user, {sanitize})`:
    without `files: edit`, each of the project's own fields (name,
    description, url, created, any field that is not a list, the owner,
    shortname, `_id`, `backup`, `modified`, `modifiedBy` or `filesLoaded`)
    gets its stored value back, or is removed if the stored project lacks
    it; returns the fields put back. A field sent empty that the stored
    project lacks is unchanged. BrainBox's version: with `sanitize` (the
    app's sanitiser of the body), a value equal to the stored one once
    sanitised is unchanged too; without it, microdraw's.
  - `saveRefusal()`: the body of the 403 answer to a save `canSaveProject`
    refuses, `{success: false, error, message}`, the reason in `error`
    and `message` (both apps' text); a new object each call.
  - `ignoredChangesMessage(ignored)`: `' Some changes (on a, b) were ignored due to
    a lack of permissions.'`, with its leading space, each name once, or
    `''` when nothing was ignored (both apps' text). Named so as not to clash with the apps' own
    `droppedMessage` (the empty rows left out), which stays in the apps.
  - `filesListIncomplete(newProject, oldProject, dropped)`: true if the
    project was sent with a `filesLoaded` that is not an object whose
    `count` is the stored files list's length (a stored project without a
    files list has 0 files; without `filesLoaded`, or without a stored
    project, false). It changes neither project: the caller puts the stored
    list back and deletes `filesLoaded`. If `dropped` is given and the list
    is incomplete, it sets `dropped.files = 0` (microdraw's version, which
    did that in its caller).
- Module `project/` (`require('neuroweblab/project')`), with its unit specs
  (`project/save.spec.js`); `test/exports.spec.js` checks the root exports.
- Nothing is renamed or removed; every 1.8.0 export is unchanged, and so is
  `AccessControlService.preventUnauthorizedUpdates`.

### Changed

- **`conformance`, slice 1 and slice 2, row 2.2**: a save needs `edit` on
  at least one list of the stored version, no longer `files: edit` (the
  rule of both apps since 2026-11-15). Slice 1 has a new member in its
  private project, files view, collaborators view, annotations edit: their
  save of the stored document is accepted (200, `success: true`). Slice 2
  has a new collaborator with the same rights: their save changing the
  layer's name and the project's name is accepted, the layer stored, the
  name kept as stored, and the message says `Some changes (on …name…) were
  ignored due to a lack of permissions.` (and does not name the
  annotations).
- **`conformance`, slice 2, new row 2.21**: the owner's save of a project
  with a shorter files list and `filesLoaded: {count: 1}` (2 stored) keeps
  the stored files list and stores the save's other change (the name).
- The reference app (`test/conformanceSave.js`) uses the new helpers; 3 new
  broken variants show the new cases fail: `filesEditToSave` (2.2, in
  slices 1 and 2), `fieldsUnchecked` (2.2), `noFilesGuard` (2.21).

### What the apps must do

Moving the pin to `#v1.9.0` brings in suite cases 2.2 (changed) and 2.21
(new). Both apps pass them as they are (microdraw a3dd277 and later,
BrainBox e97e408 and later): nothing is required to pass. The apps may then
replace their copies with the helpers: microdraw `canSaveProject`,
`keepFieldsWithoutFilesEdit`, `filesListIncomplete` and the 403 body in
`project.controller.js` (M2b); BrainBox the same, its inline files guard
with `filesListIncomplete`, moved before the rights check as in microdraw,
and `keepFieldsWithoutFilesEdit` given `{sanitize: sanitizeValue}` (M2c).
An app that names an incomplete list's dropped files must pass `dropped`.

## 1.8.0 — 2026-11

### New

- **Shared helpers, exported from `require('neuroweblab')`** (stage 4,
  merge M1). Each is the apps' code, with its behaviour unchanged:
  - `escapeRegex(str)`: NeuroWebLab's own `db/escapeRegex.js`, now exported.
  - `jsonForScript(value)`: JSON safe inside an inline `<script>`: `<`, `>`,
    `&`, U+2028 and U+2029 become `\u` escapes (microdraw's `scriptJSON`;
    BrainBox's `jsonForScript` did not escape `&`).
  - `jsonForAttribute(value)`: the same, also safe inside a single-quoted
    attribute (`'` escaped too; BrainBox's).
  - `toId(id)`: the `ObjectId` (NeuroWebLab's driver) of a 24-digit hex
    string in either case, else `null` (microdraw's; BrainBox's `toObjectId`
    took lower case only).
  - `catchErrors(handler, respond)`: an async Express handler whose error
    answers 500 `{error: 'Server error'}` (or `respond(res)`) instead of
    becoming an unhandled rejection; nothing is sent after the headers; the
    error is logged with `req.log`, else `console` (microdraw's, which
    fell back to its pino logger).
  - `usernameFromCookie(sessionParser, cookie)`: the username of the
    session a cookie belongs to, or `null` (for the WebSocket servers). It
    reads `username` and the configured `usernameField` (microdraw read
    `username` only, BrainBox `username` or `nickname`).
- Module `util/` (`require('neuroweblab/util')`), one file per helper;
  `usernameFromCookie` is in `auth/sessionUser.js`. Unit specs next to each
  file, with the apps' cases and new ones; `test/exports.spec.js` checks the
  root exports.
- Nothing is renamed or removed; every 1.7.0 export is unchanged.

### What the apps must do

Nothing is required. The apps may move the pin to `#v1.8.0` and replace
their copies: microdraw `escape.js` `scriptJSON` (keep `escapeHTML`),
`toId.js`, `catchErrors.js`, `microdrawWebsocketServer/sessionUser.js` and
its three `escapeRegex`/`escapeRegExp` (M1b); BrainBox
`utils/jsonForScript.js`, `admin.projects.js` `toObjectId`, the cookie part
of `atlas-write-access.js` and its two `escapeRegex` (M1c). In BrainBox,
inline JSON then also escapes `&` (the same value once parsed).

## 1.7.0 — 2026-11

### Changed

- **`conformance`, slice 1: the statuses of rows 1.5 and 1.6**, as the
  maintainer decided them on 2026-11-11 (coordination
  `tasks/proposed-shared-pm-tests.md`, Log). `1.5/status`: a visitor
  without `files: view` gets 401 logged out and 403 logged in (by session
  or by token) on the project page, the settings, `GET /project/json/:p`
  and `/files`; before, 401 for all on the first three and 403 for all on
  `/files` (BrainBox's). An unknown token is logged out (1.12: 401).
  `1.6/status`: `GET /project/json/:p` of an unknown project answers 404
  with a JSON `{error}`; before, 200 with an empty body.
- `checks.noViewStatus(who)`: the code expected.
- The reference app answers the new statuses; 3 broken variants show each
  can fail: `noView401` (401 for all), `noView403` (403 for all),
  `unknownJSONEmpty` (200 empty). Only `<row>/status` fails on them.

### What the apps must do

Move the pin to `#v1.7.0`. BrainBox: 403 to logged-in visitors without the
right, 401 logged out on `/files`, and 404 `{error}` for an unknown project's
JSON. microdraw: 401 to logged-out visitors, and the route `/files`. Then
remove `1.5/status`, `1.6/status` and `route:files` from
`expectedDifferences`.

## 1.6.0 — 2026-11

### New

- **`conformance`: slice 5, `projectAdmin(adapter)`: admin** (5 cases per
  admin GET route and 3 per other route, 3 for the page, 1 for the version
  rule, and the final check). The rules are the ones the maintainer approved
  on 2026-11-11 (coordination `tasks/proposed-shared-pm-tests.md`, "Slice 5:
  rules"), each case tagged with its row: every admin JSON route the adapter
  lists answers 401 logged out and 403 to a logged-in non-admin, by session
  and by token, and an admin's GETs answer 200 by session and by token; POSTs
  are only checked for refusals, the suite never runs an admin action
  through them (5.1); the admin page answers 401 logged out with the login
  prompt, 403 to a non-admin, 200 to an admin (5.2); an admin change to a
  project stores a new current version and keeps every earlier one,
  unchanged, as a backup (5.4). Not in the slice: 5.3 and 5.5 (the tools
  differ by data model), and the log and the lock of 5.4 (per app).
- New optional adapter field, used by slice 5 only: `admin`, with
  `routes` (`[{method, path}]`, GET, POST or DELETE, a path may carry a
  query), `page` (default `/admin`), `user()` (an admin, a `User` as
  `createUser`'s; removed by `removeUser`) and `changeProject(admin,
  shortname)` (one of the app's admin actions on a project the slice stored;
  it may store versions of its own first). A missing one fails with a
  message naming it.
- `ADMIN_RULES` (`5.1`, `5.2`, `5.4`) in `RULES`.

### Changed

- The reference app gains admin routes (`test/conformanceAdmin.js`); 7 broken
  variants show each slice 5 rule can fail (a non-admin let through, a token
  not counted as a login, the page open logged out, the page without the
  login prompt, an admin change that overwrites the current version without
  a backup, one that leaves the previous version current, one that changes
  the previous version).

### What the apps must do

Nothing, until they move the pin to `#v1.6.0`. Then: call
`projectAdmin(adapter)` after the other four, add `admin` (its routes, an
admin user, an admin change), and declare the rows they still differ on
(BrainBox 5.2: its admin page answers 200 logged out).

## 1.5.0 — 2026-11

### Changed

- **`conformance` slice 4, row 4.2: `anyone` is the minimum a named
  collaborator has.** A member's level on a project's annotations is the
  higher of their own row and `anyone`, as on the lists of slice 1 (decided
  by the maintainer 2026-11-11). 1.4.0 asserted the own row first, else
  `anyone`, so a member whose row was below `anyone` lost access that any
  logged-in user had; on microdraw's production 13 member rows were in that
  case. The members-below-`anyone` cases are still tagged 4.2.
- The reference app (`test/conformanceAnnotations.js`) follows the new rule;
  its broken variant is now `ownRowFirst` (was `maxLevel`).

### What the apps must do

Nothing, until they move the pin to `#v1.5.0`. Then: microdraw no longer
declares 4.2 (it already takes the higher of the two); BrainBox declares 4.2
until its annotation checks take the higher of the two.


## 1.4.0 — 2026-11

### New

- **`conformance`: slice 4, `projectAnnotations(adapter)`: annotations by
  project** (36 cases and the final check). The rules are the ones the
  maintainer approved on 2026-11-11 (coordination
  `tasks/proposed-shared-pm-tests.md`, "Slice 4: rules for the differing
  rows"), each case tagged with its row: reading needs `annotations: view`
  (4.1); the member's own row counts if there is one, else `anyone`, so a
  row lower than `anyone` lowers (4.2); writing needs `annotations: edit`,
  and a refused write changes nothing stored (4.3); a logged-out visitor
  never writes, even where `anyone` may edit (4.4). Three projects (`anyone`
  none, view, edit), each read then written by the owner, members at each
  level, members below `anyone`, a logged-in non-member and a logged-out
  visitor. Not in the slice: 4.5, 4.6 (per app); 4.7 is 2.24.
- New optional adapter fields, used by slice 4 only: `annotations.read(user,
  shortname, file)` (`{refused: true}` or `{value}`), `annotations.write(user,
  shortname, file, value)` (true if accepted) and `annotations.file` (the file
  the projects list). `user` is the logged-out visitor too (`username: null`,
  a client without a session). The transport is the adapter's: BrainBox's
  uses its WebSocket.

### Changed

- `annotations.add` and `annotations.readable` (slice 2) and the new
  `read`/`write` (slice 4) are each optional for the other slice: an adapter
  with one pair only runs that slice, and the other's missing function is
  named.
- The reference app (`test/conformanceApp.js`, `test/conformanceAnnotations.js`)
  reads and writes annotations by the approved rules; 8 broken variants show
  each slice 4 rule can fail (the highest level instead of the own row, a
  logged-out write accepted, a refused write that still stores, …).

### What the apps must do

Nothing, until they move the pin to `#v1.4.0`. Then: call
`projectAnnotations(adapter)` after the other three, add
`annotations.read`/`write` (and `file` if the projects must list a file the
app can open), and declare the rows they still differ on (BrainBox 4.4,
microdraw 4.2).

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
