# Changelog

## 1.22.0 — 2026-11

### New

Exported from `require('neuroweblab')` (stage 4, merge M15a, decision D5
option B: one shared handler, the rows and the answer's key the app's).

- **`userProjectsRoute({ db, canView, rows, answer })`** (`routes/userProjects.js`),
  `GET /user/json/:userName/projects?[start][&length]`, shaped as
  `projectFilesRoute` (1.17.0): a missing adapter function is a `TypeError`
  naming it, at start-up; any rejected read or hook goes to `next(err)`, so the
  app's `errorHandler` answers it (a 500 `{error}`). In this order:
  - one read on the configured `projectsCollection`, current versions only
    (`CURRENT`): the user is the `owner`, or a collaborator row names them by
    `userID`, `username` or `nickname` (BrainBox's `$or`). The collection's
    natural order, unsorted, as both apps today (both user pages sort in the
    browser);
  - `canView(req, project)` (may return a promise), then sliced: `length` from
    `start`, both optional (no `start` from the first, no `length` all). A
    value that is not a string of decimal digits (`abc`, `-1`, `1.5`, empty,
    an array) counts as not given; past the end, an empty page;
  - `res.json(answer(await rows(req, page)))`: `rows` gets the whole page (so
    microdraw reads the newest annotations of the page in one query) and may
    return a promise; `answer(list)` is the answer's object, sent as is.
  - An unknown user has no projects: the answer of an empty list.
- **`publicUser(doc, usernameField)`** (`user/publicUser.js`): a new object
  with the username field and **`PUBLIC_USER_FIELDS`** (`['name', 'avatarURL',
  'url', 'joined']`, frozen), only those `doc` has as its own properties
  (BrainBox's `hasOwnProperty`). `usernameField` defaults to the configured
  one. `{}` for a non-object, never a throw. An allow-list: `passhash`,
  tokens, `email`, `strategy` and any field added later stay private.
- **`publicLoggedUser(reqUser, usernameField)`**: BrainBox's; `null` logged
  out, else `publicUser` plus `username`.

### What the apps must do

- **microdraw** (M15b):
  - `userProjectsRoute({ db: (req) => req.appConfig.db.nativeMongoDB(),
    canView: (req, p) => AccessControlService.canViewFiles(p, visitor(req) || 'anyone'),
    rows: async (req, page) => { annotated = await newestAnnotations(db, page.map((p) => p.shortname));
    return page.map((p) => projectRow(p, visitor(req) || 'anyone', annotated)); },
    answer: (list) => ({ successful: true, list }) })`. `userProjectsPage`,
    `queryInt` and `api_userProjects` go; `findUserProjects` stays (`userTabs.js` reads it).
  - `publicUser(doc)` (its `usernameField` is `username`) in place of its own
    `publicUserFields`/`publicUser`. `publicLoggedUser` is not needed: the user
    page sends `req.user || null`, and the session user is already reduced by
    NWL (`auth/sessionUser.js`: `username`, `name`, `avatarURL`, `url`,
    `joined`), the same fields; it may use it as a guard.
- **BrainBox** (M15c):
  - `userProjectsRoute({ db: (req) => req.nativeDb,
    canView: (req, p) => BrainboxAccessControlService.hasFilesAccess(AccessLevel.VIEW, p, visitor(req) || 'anonymous'),
    rows: (req, page) => page.map(…its row…), answer: (list) => ({ success: list.length > 0, list }) })`.
    `getUserProjectsSlice` and `sliceOf` (if unused elsewhere) go. Its row
    reads `o.files.list.length`: a project without a files list fails the
    whole listing (today a 200 `{success: false, list: []}`, a 500 after the
    switch); count it as 0, as microdraw does.
  - `publicUser`, `publicLoggedUser` from NWL (its `usernameField` is
    `nickname`). NWL's `PUBLIC_USER_FIELDS` has no username field: `apiUser`'s
    `?var=` check (`PUBLIC_USER_FIELDS.includes(field)`) must take
    `['nickname', ...PUBLIC_USER_FIELDS]`, or `?var=nickname` answers `null`.

### What changes for each app, once it uses the factory

| Case | microdraw today | BrainBox today | 1.22.0 |
|---|---|---|---|
| error (a failed read or rows) | 500 `{successful: false, list: []}` | **200** `{success: false, list: []}` | the errorHandler's 500 `{error: 'Server error'}` |
| a row naming the user by `nickname` only | not listed | listed | listed |
| `length=` (empty) | 0: an empty list | all | all |
| `start` or `length` `1.5`, `3abc` | the default | `parseInt`: 1, 3 | the default |
| `3.0`, `1e1`, `0x10`, ` 3` | `Number`: 3, 10, 16, 3 | 3, 1, 0, 3 | the default |
| `abc`, `-1` | the default | the default | the default |
| keys, rows, order | unchanged | unchanged | unchanged |

The user pages after an error: microdraw's (`user-page.js`) reads
`res.successful`, undefined, so it stops loading quietly, as before.
BrainBox's reads `res.success & (res.list.length > 0)`: `res.list` is
undefined, so the page's `fetchProjects` throws (an unhandled rejection in the
console) and stops; the rows already loaded stay, as before. `&&` there
would stop quietly.

`publicUser` for microdraw: an inherited field is no longer copied, and a
non-object gives `{}` instead of a throw. A stored `null` is kept, as before.
An own `undefined` is now kept as a key, where microdraw skipped it, but
`res.json` and `jsonForScript` drop it: no answer changes (MongoDB stores no
`undefined`). BrainBox: unchanged.

### The suite

- **3.16**: a project with a row naming the user by `nickname` only is listed
  (a new project of the slice, `unick`). microdraw fails it until M15b.
- **3.17**: `start` at or past the end gives an empty list (`start=4&length=3`,
  `start=100`), a `length` past the end the rest.
- **3.18**: a `start` or `length` that is not a string of digits (`abc`, `-1`,
  `1.5`, empty) counts as not given. BrainBox fails it until M15c (`1.5` is
  1), microdraw until M15b (`length=` is 0).
- **3.19**: `GET /user/json/:u` (new route `user`), anonymous and the user
  themself: an object, the username and the name, no field outside
  `username`, `nickname`, `name`, `avatarURL`, `url`, `joined`, no email
  (stored by `setUserFields`). 3.7 checked the user search only.
- The reference app builds its `/user/json/:userName/projects` with the
  factory (`test/conformanceUserProjects.js`), over its store as a Db stub
  that now answers `find` (`test/conformanceAccess.js`). Its variants:
  `userIDOnly` (3.3) and the new `noNickname` (3.16) are keys the stub's find
  never matches; `sliceBeforeFilter` makes the stub page by the query before
  the factory filters (it now also fails 3.17 and 3.18); `rangeRequired`
  answers before the factory; `hiddenCollaboratorsCounted` and `noModified`
  (3.5) are in `rows`. New: `noListWhenEmpty` (`answer` without a list, 3.17
  and 3.5), `nonNumericAsZero` (3.18, the query rewritten before the
  factory), `userDocumentExposed` (3.19, the whole user document).

## 1.21.0 — 2026-11

### New

- **The project routes' access skeleton**, exported from `require('neuroweblab')`
  (stage 4, merge M14a, decisions D1 option C and D4 option B), in
  `routes/projectAccess.js`, shaped as `projectFilesRoute` (1.17.0): a missing
  adapter function is a `TypeError` naming it, at start-up; any rejected read
  or hook goes to `next(err)`, so the app's `errorHandler` answers it (a page
  as a page, JSON as JSON; nothing is caught and answered 200).
- **`visitor(req)`**: the username, or `null` when logged out (also for a
  request without `isAuthenticated`). NWL's `authTokenMiddleware` sets
  `req.user = {username}` for a valid token and nothing for an expired or
  unknown one, and passport's `isAuthenticated()` is true when `req.user` is
  set: sessions and tokens are both covered. microdraw's
  `req.isTokenAuthenticated` branches (`getLoggedUser`, `project`,
  `settingsUnsafe`, `apiProjectUnsafe`, `projectNew`) are dead code: a valid
  token already made `isAuthenticated()` true, an expired one sets
  `isTokenAuthenticated = false` (tested in `routes/projectAccess.spec.js`).
- **`noViewStatus(req)`**: 401 logged out, 403 logged in (shared suite 1.5).
- Five factories. The four that read the project take `db` ((req) => the
  native Db) and `projection` (default `{_id: 0}`; `{}` for the whole
  document), and read `findCurrentProject(db, req.params.projectName, {projection})`:
  - **`projectPageRoute({ db, canView, render })`**, `GET /project/:projectName`:
    `req.session.returnTo = req.originalUrl` (if there is a session); unknown
    404 text `Project Not Found`; no view right `noViewStatus(req)` text `Not
    authorized to view project`; else `render(req, res, project)`.
  - **`projectSettingsRoute({ db, canView, blankProject, render })`**,
    `GET /project/:projectName/settings`: `returnTo`; a stored project without
    the view right, as the page; no stored project `blankProject(req)`, not
    checked; then `render(req, res, project, { isNew })`.
  - **`projectJsonRoute({ db, canView, visible })`**, `GET /project/json/:projectName`:
    unknown 404 `{error: 'No project <name>'}`; no view right
    `noViewStatus(req)` `{error: 'Not authorized to view project'}`; else
    `visible(req, project)`, and with `?var=a/b` the value at that path, by
    `res.json`. Own properties only: a path ending on a missing value answers
    `res.json(undefined)` (an empty 200, as before), a path through one a 500
    (as before).
  - **`projectSaveRoute({ lockKeys, save })`**, `POST /project/json/:projectName`:
    logged out 401 `{success: false, error: 'User not authenticated', message:
    'User not authenticated'}`, without the lock; else `save(req, res,
    username)` inside `withLock(lockKeys(req))` (project/lock.js, the apps'
    `projectLock.js` lock). The save, its 403 and 400 and its answer stay the
    app's.
  - **`projectDeleteRoute({ db, lockKeys, canRemove, remove })`**,
    `DELETE /project/json/:projectName` (the wrapper; the delete is the app's,
    D4): logged out 401, as the save, without the lock; inside the lock,
    unknown 404 `{success: false, error: 'Project not found', message: …}`,
    `canRemove(req, project)` false 403 `{success: false, error: 'The user is
    not allowed to delete this project', message: …}`, else `extra = await
    remove(req, project, username)` and 200 `{success: true, message: 'Project
    deleted', ...extra}`.
- What stays the app's (in the JSDoc): BrainBox's express-validator
  `validator`, the `/project/new` page, the routers and the middleware order
  (`authTokenMiddleware` where each app puts it), and the hooks.

### What the apps must do

Each hook maps `visitor(req) === null` to the app's sentinel; none enters NWL.

- **microdraw** (M14b): `db: (req) => req.appConfig.db.nativeMongoDB()`;
  `canView: (req, p) => AccessControlService.canViewFiles(p, visitor(req) || 'anyone')`;
  `render` the page and the settings page as today (`visibleProject`, the
  collaborators' names, `files.list` emptied, `filesLoaded`); `blankProject`
  its new project (owner `visitor(req) || 'anyone'`);
  `visible: (req, p) => visibleProject(p, visitor(req) || 'anyone')`;
  `lockKeys: (req) => [projectKey(req.params.projectName)]`; `save` its
  `saveProject`; `canRemove` the REMOVE right; `remove` its
  `deleteStoredProject`, resolving `{ log }`. **The delete needs
  `projection: {}`**: its log entry keeps the project's `_id` (`projectId`,
  test/api/project-lock.spec.js:184). Drop `getLoggedUser`'s token branch.
- **BrainBox** (M14c): `db: (req) => req.nativeDb`; `canView` and `canRemove`
  with `visitor(req) || 'anonymous'`; `render` its page and settings page;
  `blankProject` its new project; `visible` `visibleProject`;
  `lockKeys: () => ['project', 'mri']` (D3); `save` its `postProject` body
  inside the lock; `remove` its three writes, resolving nothing. The
  `validator` stays before the routes.

### What changes for each app, once it uses the factories

| Case | microdraw today | BrainBox today | 1.21.0 |
|---|---|---|---|
| page, settings refusal | same | `Authorization required` | `Not authorized to view project` |
| JSON refusal | same | `{error: 'Authorization required'}` | `{error: 'Not authorized to view project'}` |
| JSON 404 | `{error: 'Project not found'}` | same | `{error: 'No project <name>'}` |
| delete 401 | `{success: false, message: 'Log in required'}` | `{success: false, message: 'User not authenticated'}` | `{success: false, error: 'User not authenticated', message: …}` |
| delete 404 | `{success: false, message: 'Project not found'}` | `message: 'Unable to delete. Project does not exist in the database'` | `{success: false, error: 'Project not found', message: …}` |
| delete 403 | `{success: false, message: …}` | the same | `error` added, the same text |
| delete error | 500 `{error: 'Server error'}` | **200** `{success: false, message: 'Unable to delete. Try again later'}` | the errorHandler's 500 `{error}` |
| page error | **400** text `Error` | 500 text `Server error` | the errorHandler's 500 (the error page) |
| settings error | 500 text `Error` | 500 text `Server error` | the errorHandler's 500 (the error page) |
| JSON, save error | 500 `{error: 'Server error'}` | the same | the errorHandler's 500 `{error}` (the message in development) |
| `?var=` a prototype key | `constructor/name` answered `"Object"`, `__proto__` `{}` | the same | a missing value: `constructor/name` 500, `__proto__` an empty 200 |
| page, settings `projectInfo._id` | sent (unread; the settings page sends it back, saves drop it) | not read | not read (default projection) |

Who reads these: nwl-components `ProjectInfo.vue` reads only `success` of a
delete and shows its own `Unable to delete project`, so no delete text is
shown, before or after; a save shows `error`, unchanged. microdraw's
`fetchJSON` and `embed-page.js` `getJSON` only read the status of `?var=`
answers. No client reads the old texts. The apps' own tests that will change:
BrainBox `test/unit/project.controller.test.js`, microdraw
`test/api/crash.spec.js`.

The settings page's blank project is no longer checked: microdraw checked it,
but its `anyone` row has `files: view`, so no visitor was ever refused.

### The suite

- **1.17**: the refusal texts of the page, the settings and the JSON
  (`Not authorized to view project`), anonymous and a logged-in non-member.
- **1.18**: an unknown project's texts: JSON `{error: 'No project <name>'}`,
  page `Project Not Found`.
- **1.19**: a valid token is its user, logged in (the owner 200, a non-member
  403); an expired one is logged out (401). A new adapter field,
  **`expiredToken(user)`**: store an expired token of the user (NWL's `log`
  collection, `{token, username, expiryDate}`) and return it.
- **2.31**: a logged-out delete, 401 `{success: false, error: 'User not
  authenticated', message: …}`, the project stays.
- **2.32**: a delete of an unknown project, 404 `{success: false, error:
  'Project not found', message: …}`.
- **2.33**: a refused delete, 403 `{success: false, error: 'The user is not
  allowed to delete this project', message: …}`.
- The reference app (`test/conformanceApp.js`, `conformanceSave.js`) builds
  its page, settings, JSON, POST and DELETE routes with the factories, over
  its store as a Db stub (`test/conformanceAccess.js`). The `broken` variants
  the factories cannot answer are applied around them: `noView401`,
  `noView403` rewrite the refusal's code; `unknownJSONEmpty` answers before
  the JSON route (it also fails 1.18 now); `unknownDelete500` makes the read
  reject (a 500 through `next`; it also fails 2.32); `noRemoveCheck` is
  `canRemove` (it also fails 2.33); `keepAnnotations` is in `remove`;
  `noLogin`, `loggedOut403` answer before the save route. New variants:
  `authorizationRequired` (1.17), `expiredTokenAccepted` (1.19),
  `loginRequired` (2.31).

## 1.20.0 — 2026-11

### New

- **`validateProject(data, { shortname, oldProject, owner, findMissingUsers, rules })`**,
  exported from `require('neuroweblab')` (stage 4, merge M13, decision D2
  option A), in `project/validate.js`. The validation both apps share of a
  document sent to `POST /project/json/:projectName`; the text and file rules
  stay the app's, through `rules`. It answers `{ project, dropped, stored }`
  or `{ error }` (a 400), and never throws for a bad document: it rejects
  only when `findMissingUsers` or a rule does, or with a `TypeError` naming a
  hook `rules` lacks. The steps, in microdraw's order:
  1. parse (a JSON string or a plain object, else `Invalid project data`);
  2. `sanitize` every string, drop `_id` and `backup`;
  3. `sortRows` each list against the stored rows sanitised (`rules.rowKey`,
     `rules.isBlankRow`): stored rows accepted as they are, blank new rows
     dropped and counted;
  4. the shortname (the URL's; a new one matches `shortnamePattern`);
  5. the three lists (`The project needs a <type> list`);
  6. `name`, `description`, `url` strings when present, then `rules.fieldsError`;
  7. the rows not stored: files (`rules.fileError`), collaborators (core:
     object, user, `username` = `userID`, access values), layers
     (`rules.layerError`); the first error, in that order;
  8. duplicate layer names; 9. an `anyone` row; 10. `username` ≠ `userID` on
     a stored row; 11. `rules.projectError`; 12. `project.owner = owner`;
  13. the users (`findMissingUsers`, once): `Unknown users: a, b`.
- **`projectRowProblems(project, rules)`**: every problem of a project's rows
  as if all were new (microdraw's `rowProblemList`), with the same per-row
  functions as step 7 and step 8, so the two never disagree.
- **`duplicateLayerNames(list, stored)`** (microdraw's) and
  **`parseProjectData(data)`** (microdraw's) are exported too.
- **`rules`**, a plain object: `collaboratorUser(row)`, `fileError(file, i)`,
  `layerError(layer, i)`, `fieldsError(project, { oldProject, isNew })`,
  `projectError(project, { oldProject, isNew, stored })` (the last two may be
  async), all required; `rowKey` (default: the whole row) and `isBlankRow`
  (default: NWL's), by list; two options added because the core could not
  otherwise keep BrainBox's behaviour:
  - `checkStoredFields` (default `true`): `false` accepts a step 6 field equal
    to the stored value sanitised. BrainBox merges the stored fields into the
    body before validating, so a stored `description: null` would block every
    save;
  - `checkStoredKeys` (default `true`, microdraw's): `false` skips step 10.
    BrainBox doesn't write both keys, and never refused a stored row for it.
- What stays the app's (in the JSDoc): merging the stored fields (BrainBox
  before, microdraw after), writing both collaborator keys (microdraw's
  `withBothKeys`), the rights (403) before the validation, the 400 answer.

### The checks

| Step | Check | Rows | microdraw text | BrainBox text | Where |
|---|---|---|---|---|---|
| 1 | parse | | `Invalid project data` | none (the next steps' `TypeError`s) | core |
| 3 | stored rows, blank rows | | | | core (`rowKey`, `isBlankRow`) |
| 4 | body shortname = URL's; new one's characters | | same texts | same texts | core |
| 5 | three lists | | `The project needs a <type> list` | collaborators, annotations: a `TypeError` text (`Cannot read properties of undefined (reading 'list')`); files: none, a new project then answers 500 | core |
| 6 | `name`, `description`, `url` strings | sent | `The project <field> must be a string` | name, description: validator's `Expected a string but received a number`; url: none | core |
| 6 | name, description whitelist | new values | none | `Invalid name`, `Invalid project description` | `fieldsError` (BrainBox) |
| 7 | file shape, source, name | new | `File i must be an object…`, `…needs a source…`, `…needs a name` | `File source not specified`, `File name not specified`, `Invalid file URL: s`, `Invalid file name "n"` | `fileError` |
| 7 | collaborator: object, user | new | `Collaborator i must be an object`, `…needs a username` | `Access values are invalid` / the users check | core |
| 7 | `username` ≠ `userID` | new | `Collaborator i has a different username (a) and userID (b): they must be equal` | none | core |
| 7 | access values | new | `Collaborator <user> has invalid access values (allowed: …)` | `Access values are invalid` | core |
| 7 | layer type, name | new | `Annotation i has an invalid type…`, `…needs a name` | `Layer i has an invalid type…`, `…needs a name` | `layerError` |
| 8 | duplicate layer names | new, against all | `Annotation i has the same name as annotation j: "n" …` | `Layer i has the same name as layer j: "n" …` | core |
| 9 | an `anyone` row | all | `The collaborators list needs an 'anyone' entry` | `User 'anyone' is not present` (`userID` only) | core |
| 10 | `username` ≠ `userID` | stored | as step 7 | none | core (`checkStoredKeys`) |
| 11 | a `volume` layer | all | none | `Annotations must contain at least 1 volume-type entry` | `projectError` (BrainBox) |
| 11 | stored file names against the `mri` documents | stored | none | `Invalid file name "n"` | `projectError` (BrainBox) |
| 12 | an owner | | none | `The project has no owner` | core |
| 13 | users exist | new rows, a new project's owner | `Unknown users: a, b` | `Users are invalid, one or more do not exist` | core (`findMissingUsers`) |

Order: microdraw checks the fields (6) before the lists (5); the core checks
the lists first, a text change only. BrainBox's order was files, fields,
shortname, owner, `anyone`, access, layers (type, name and duplicate, layer
by layer), `volume`, stored file names, users.

### What the apps must do

Nothing changes until an app switches (M13b, M13c).

**microdraw** (M13b): `checkProject` calls `validateProject` with
`collaboratorUser: collaboratorName`, its `fileError` and `annotationError`
(as `layerError`), its `rowKey` and `isBlankRow`, `fieldsError` and
`projectError` returning null; it keeps `withBothKeys` after it, and
`missingUsers(db, names)` as `findMissingUsers`. `project.check.js` uses
`projectRowProblems` for `rowProblemList`. **Stricter:** nothing. **Texts:**
none, but a document with both a bad field and a missing list answers the list.

**BrainBox** (M13c): `isProjectObject` becomes `validateProject` with
`collaboratorUser` (project-rows.js), `rowKey`, `fileError` (the source and
the whitelisted name), `layerError` (`layerTypes`, a name), `fieldsError`
(the whitelist, a stored value kept), `projectError` (a `volume` layer, the
stored file names against `mri`), `checkStoredFields: false`,
`checkStoredKeys: false`, and a `findMissingUsers` on `user.nickname`;
`postProject` checks the rights (403) before. **Stricter, new rows or values
only:** a `username` and `userID` both set and different; a `url` that isn't a
string; a new project without a files list (400, was 500). **Less strict:** an
`anyone` row is also read by `nickname` or `username`; `anyone` isn't looked
up as a user. **Texts that change** (steps 5, 6, 7, 8, 9, 13): the core's
above. The settings page shows `error`: step 8 says "Annotation" where
BrainBox says "Layer", and the step 7 `username`/`userID` text names a key
BrainBox's page doesn't show (only an API client can send it).

### Suite

- **2.27**: a new project without its files, collaborators or annotations
  list is refused. **2.28**: a new collaborator row that isn't an object, or
  names its user with a number, is refused (a row naming nobody is blank and
  dropped, 2.14). **2.29**: a new row whose `username` and `userID` name two
  users is refused. **2.30**: a `name`, `description` or `url` that isn't a
  string is refused. **2.14** gains a case: a stored collaborator row with
  `files: 'viewer'` is accepted as it is. The existing cases are unchanged.
- The reference app (`test/conformanceSave.js`) validates with
  `validateProject` and rules of its own (its blank rows: a value missing or
  spaces, so a row naming its user with a number is refused, 2.28). The variants of a core check work
  around it: `shortnameFromBody` and `ownerFromClient` pass the body's (no owner: the
  core refuses);
  `keepClientFields` puts `_id`/`backup` back; `noAnyone` adds an `anyone` row
  for the check and removes it; `accessSubstring` reads "viewer" as "view";
  `usersEveryRow` checks every row after; `validateStoredRows` gives a
  `rowKey` that never matches and no blank rows; `sanitizeJSON` escapes `&`
  first; `noLayerNames` drops the name check (the core still refuses
  duplicates). New variants: `listsOptional` (2.27), `badRowsDropped` (2.28),
  `differentKeysAllowed` (2.29), `fieldTypesUnchecked` (2.30).
- `project/validate.spec.js`, with no database; `test/exports.spec.js` checks
  the new names. Nothing is renamed or removed.

## 1.19.0 — 2026-11

### New

- **`keepListsWithoutEditRights(newProject, oldProject, user, { rowKey, oldRows } = {})`**,
  exported from `require('neuroweblab')` (stage 4, merge M12), in
  `project/save.js` next to `keepFieldsWithoutFilesEdit`. The rights each
  list's changes need, both apps' rule (shared suite 2.3, 2.4, 2.26). For
  `collaborators`, `files` and `annotations`, in that order, against the
  stored rows (`listOf(oldProject, type)`, `[]` for a missing list) and the
  user's rights on the stored project (`AccessControlService.hasAccess`):
  - a longer list needs `add`, a shorter one `remove`;
  - a list that differs in any other way (a row changed in place, or moved)
    needs `edit`: the rows sent, mapped by `rowKey[type]`, are not
    `_.isEqual`, in order, to the comparison rows mapped the same way;
  - `add` and `remove` imply `edit` (the levels are ordered).
  A list whose change is not allowed is set back to the stored rows. It
  returns the lists whose changes were ignored, each once, in list order.
  - `rowKey`: what a row is compared on, by list (a function of the row); a
    list without one compares whole rows. A key that is not a function is a
    `TypeError`.
  - `oldRows`: the rows to compare with, by list, instead of the stored ones
    (BrainBox's stored rows sanitised as the body, as given to `sortRows`). A
    list put back is always the stored one, never `oldRows`.
  - `newProject` is changed in place. Both apps' validation refuses a
    document without the three lists before the call, so they aren't checked.
    A new project (no `oldProject`) is the caller's: both apps skip the call.
- `AccessControlService.preventUnauthorizedUpdates` stays, unchanged; its
  JSDoc now says it checks only the lengths.
- **Suite rule 2.26** (slice 2, save; the next free number, 2.11 being the
  files' shape): a collaborator with `files: edit`, `collaborators` and
  `annotations: view` reverses the files and the two layers and swaps two
  collaborator rows: the collaborators and layers are kept in the stored
  order and named in "Some changes (on …) were ignored", the files are stored
  in the new order; a second case checks a collaborator with `edit` stores all
  three reorders. 2.4 only checked rows changed in place, and is unchanged.
- The reference app (`test/conformanceSave.js`) uses
  `keepListsWithoutEditRights` with its `rowKey`, instead of
  `preventUnauthorizedUpdates` and its own `keepInPlace`. Its variants keep
  their meaning: `lengthsOnly` (no length checks, only `edit` on a list that
  differs; fails 2.3, 2.20), `noInPlaceCheck` (only the lengths, i.e.
  `preventUnauthorizedUpdates`; now fails 2.4 and 2.26), and a new
  `unorderedRows` (the edit check ignores the order; fails 2.26 only).
- Unit cases in `project/save.spec.js`, with no database; `test/exports.spec.js`
  checks the new name.
- Nothing is renamed or removed; every 1.18.0 export is unchanged.

### What the apps must do

Nothing changes until an app switches (M12b, M12c):

**microdraw** (M12b): in `saveProject`, replace
`preventUnauthorizedUpdates` and its own `keepListsWithoutEditRights` with
NWL's `keepListsWithoutEditRights(newProject, oldProject, loggedUser, {
rowKey: comparableEntry })`, keeping `keepFieldsWithoutFilesEdit` after it.
The lists stored are the same. One difference, in the message only: microdraw
names the lists refused for their length first, then those refused for `edit`
(`_.union`); NWL names them in list order (e.g. "on collaborators,
annotations" instead of "on annotations, collaborators" when a layer is added
without `add` and a collaborator row changed without `edit`). A stored project
without one of the lists was a `TypeError` in `preventUnauthorizedUpdates`; it
is now `[]`.

**BrainBox** (M12c): in `postProject`, replace the loop with
`keepListsWithoutEditRights(object, oldProject, loggedUser, { rowKey,
oldRows: oldLists })` (`rowKey` from `project-rows.js`; `listChanged` is then
unused there). No change in behaviour: same order, same comparison, same
lists put back; a stored project without one of the lists, a `TypeError`
before, is now `[]`.

**Suite rule 2.26:** both apps pass both cases on their current code
(microdraw f96b471: 1286 mocha and 378 e2e passing; BrainBox bb1f529: 1740
passing, 6 pending). Both compare the lists in order (microdraw's
`comparableEntry` with `_.isEqual`, BrainBox's `listChanged`), so a move
without `edit` is already kept as stored and named.

## 1.18.0 — 2026-11

### New

- **The project lock, exported from `require('neuroweblab')`** (stage 4,
  merge M11), in `project/lock.js`. microdraw's
  `app/controller/projectLock.js` is the reference: one FIFO queue per key,
  in a `Map` of the module; here a holder may take several keys.
  - `withLock(keys, fn)`: `keys` a non-empty string or a non-empty array of
    them. Runs `fn` (sync or async, called with no argument) once every
    earlier holder of each key has finished, FIFO per key; resolves with what
    `fn` returns, rejects with what it throws (every key released). Several
    keys: duplicates dropped, sorted, taken one after the other, each in its
    own queue, so `['a','b']` and `['b','a']` never deadlock; a holder of
    `['project','mri']` excludes one of `'mri'` alone and the other way
    round; released in the reverse order. A non-string key, an empty string
    or an empty array rejects with a `TypeError` naming it, without calling
    `fn`. No timeout, no limit on waiting holders.
  - `isLocked(key)`: whether someone holds or waits for `key` (mainly for
    tests); false once all is done (a key's entry is deleted when its last
    holder leaves).
  - `projectKey(shortname)`: `` `project:${shortname}` ``.
  - `withProjectLock(shortname, fn)`: `withLock(projectKey(shortname), fn)`.
  - The lock covers one process, and needs a single copy of `neuroweblab`
    per app (`npm ls neuroweblab` shows one in both apps today).
- Unit spec `project/lock.spec.js`, with no database; `test/exports.spec.js`
  checks the new names. No new conformance cases: the lock isn't visible
  from HTTP beyond 2.20, which both apps pass.
- Nothing is renamed or removed; every 1.17.0 export is unchanged.

### What the apps must do

Nothing changes until an app switches (M11b, M11c):

**microdraw** (M11b): `app/controller/projectLock.js` re-exports
`withProjectLock` and `projectKey`, with `acquire = withLock` and
`isProjectLocked = (s) => isLocked(projectKey(s))`. Its callers and tests
keep the same names. No change in behaviour.

**BrainBox** (M11c): `controller/projectLock.js` exports `{ acquire:
withLock }`, so `lock.acquire(['project', 'mri'], async function () {…})`
keeps working (its four call sites pass a promise-returning function with no
`done` argument and no options). Differences from async-lock 1.4.1:
- async-lock takes an array's keys in the order given (nested acquires);
  NWL sorts them (`mri` before `project`) and drops duplicates (async-lock
  deadlocks on `['a','a']`). With one lock instance and always the same
  array, nothing changes for BrainBox.
- async-lock's `maxPending` defaults to 1000 per key: the 1001st waiter is
  rejected with `Too many pending tasks in queue <key>`. NWL has no limit.
  BrainBox's global `project` key would have hit it only with 1000 saves,
  deletes or admin fixes waiting at once; none of its tests rely on it.
  `timeout`, `maxOccupationTime` and `maxExecutionTime` default to 0 (never)
  in async-lock too, so there is no difference there.
- async-lock calls a `fn` of one argument with a `done` callback, and takes
  options (`timeout`, `skipQueue`, …); an empty array runs `fn` without a
  lock. NWL has none of these: an empty array is a `TypeError`.
- On rejection both reject with `fn`'s error and release every key.
- `isBusy()` becomes `isLocked(key)` (BrainBox doesn't call it).

BrainBox's four other `new AsyncLock()` instances (`admin.annotations.js`,
`atlasmakerServer.js`, `mri.controller.js`, `upload.controller.js`) stay for
now (decision D3), with the `async-lock` dependency.

## 1.17.0 — 2026-11

### New

- **The paged files route and the project listing, exported from
  `require('neuroweblab')`** (stage 4, merge M10), in `routes/projectFiles.js`
  and `routes/projectList.js`. microdraw's code is the reference; what is
  answered for a file or a project is the app's (an adapter, as
  `projectEmbedRoute`'s). Both read the configured `projectsCollection`
  (`Configuration`), current versions only (`CURRENT`). A missing or
  non-function adapter field throws at creation, naming it. An error (a
  failed read, a rejected `entries` or `row`) is passed to `next`, so the
  app's `errorHandler` (1.13.0) answers it; `catchErrors` stays as a last
  guard.
  - `projectFilesRoute({db, canView, noViewStatus, entries})`:
    `GET /project/json/:projectName/files?start&length[&names=true]`. In this
    order: a missing `start` or `length` is 200 `{error: "Provide 'start'"}`
    (or `'length'`), before any read; an unknown project 404 `{error: 'No
    project <name>'}` (`findCurrentProject`); no view right
    (`canView(req, project)` false) `noViewStatus(req)` with `{error: 'Not
    authorized to view project'}`; else the slice of `files.list` (`[]` if
    not an array): `start` and `length` by `parseInt`, a non-number or a
    negative value counting as 0, cut to the list (past its end, `[]`). The
    answer is `await entries(req, project, slice, {names})`, `slice` being
    the raw items, `names` true for `names=true`. `db(req)` is the native
    `Db`.
  - `projectListRoute({db, canView, row, projection})`: `GET
    /project/json?page`. No `page`: 200 `{error: "Provide the parameter
    'page'"}`, BrainBox's text, for both apps. The page is
    `Math.max(0, parseInt(page) || 0)`. Every current project is read with
    `projection`, filtered by `canView(req, project)` (a promise is awaited),
    then `PROJECTS_PER_PAGE` (20) per page, each answered as
    `await row(req, project)`. `projection` defaults to BrainBox's, `{_id: 0,
    shortname: 1, name: 1, owner: 1, collaborators: 1, 'files.list': 1}`; a
    given one must hold what `canView` and `row` read.
  - `PROJECTS_PER_PAGE`: 20.
- **Conformance, slice 3: 5 new rules**, `3.11` … `3.15`, in
  `conformance/listingsPaging.js` (8 cases), on a public project of 5 files
  the slice now stores (`paged`; 69 projects, 26 public):
  - 3.11 `/files?start=1&length=2` gives the 2nd and 3rd files, in list
    order; a `start` past the end gives `[]`;
  - 3.12 a negative or non-numeric `start` or `length` counts as 0;
  - 3.13 `names=true` gives `{source, name}` rows only, `name` a string;
  - 3.14 `/files` without `start` or without `length`: 200 with an `error`
    key;
  - 3.15 the listing: a non-numeric or negative `page` is page 0; no `page`
    is 200 with an `error` key.
  The files route is the new route template `filesPaged` (default
  `/project/json/:p/files`). The reference app (`test/conformanceApp.js`)
  follows them; `conformance/projectListings.spec.js` has 6 new variants,
  each failing its rule only. What the existing cases check is unchanged.
- Unit specs in `routes/projectFiles.spec.js` and `routes/projectList.spec.js`,
  on the test MongoDB; `test/exports.spec.js` checks the new names.
- Nothing is renamed or removed; every 1.16.0 export is unchanged.

### What the apps must do

An app moving to 1.17.0 gets the new suite cases (3.11-3.15): it must pass
them, or declare the rules it fails in `expectedDifferences` with a ledger
reference (ledger rows "Paged project files route" and "Project listing").
Switching to the routes is the next step of each app (M10b, M10c):

**microdraw** (M10b):

```js
const adapter = { db: (req) => req.appConfig.db.nativeMongoDB(), canView: (req, p) => AccessControlService.canViewFiles(p, getLoggedUser(req)),
  noViewStatus: (req) => noViewStatus(getLoggedUser(req)) };
router.get('/json/:projectName/files', projectFilesRoute({ ...adapter, entries: (req, p, slice, { names }) => slice.map((f) => fileEntry(f, names)) }));
router.get('/json', projectListRoute({ ...adapter, row: (req, p) => p.shortname, projection: { _id: 0, shortname: 1, owner: 1, collaborators: 1 } }));
```

Changes for it: no `page` answers `Provide the parameter 'page'` (was `The
'pages' parameter has to be specified`; no client or test reads it), and a
failure goes to its `errorHandler` instead of its own 500 `{error: 'Server
error'}`.

**BrainBox** (M10c): `db: (req) => req.nativeDb`, `canView` its
`hasFilesAccess(VIEW, project, loggedUser)`, `noViewStatus` its own;
`entries` the `mri` lookup of `getProjectFilesSlice` (one `$in` on the
slice's sources, `{source, name: ''}` for a file without an `mri` document,
`{source, name}` with `names`); `row` its `getProjectsSlice` row `{project,
projectName, numFiles, numCollaborators, owner}`; the default `projection`.
Changes for it: a negative or non-numeric `start`/`length` is clamped to 0
(a negative `start` sliced from the end), a non-numeric `page` is page 0
(was `NaN`), the no-view message is `Not authorized to view project` (no
username in it), a failure goes to its `errorHandler`, and there is no
`console.log` per request.

## 1.16.0 — 2026-11

### New

- **Project versions, exported from `require('neuroweblab')`** (stage 4,
  merge M9), in `project/versions.js`. microdraw's
  `app/controller/project/currentProject.js` is the reference; its dataset
  step becomes an `afterSave` hook, and the collection is the configured
  `projectsCollection` (`Configuration`), read on each call (microdraw's is
  `projects`, BrainBox's `project`). The queries need the `{shortname: 1}`
  index, which each app creates.
  - `CURRENT`: `{backup: {$exists: false}}`, the query of the current
    version(s). `NEWEST_FIRST`: `{sort: {_id: -1}}`.
  - `findCurrentProject(db, shortname, {projection})`: the current version
    of a project; of several, the newest `_id`. `null` if there is none, or
    if `shortname` isn't a string (no query). `projection` is optional
    (the whole document without it).
  - `saveProjectVersion(db, doc, {by, keepModified, afterSave})`: inserts a
    copy of `doc` without `_id` and `backup`, with `modified` (an ISO string)
    and `modifiedBy: by` unless `keepModified`, **then** marks the other
    current documents of its shortname `backup: true`; returns the stored
    copy with its new `_id`. `doc` is not changed. Insert first: a failure
    between the two writes leaves two current versions (reads take the
    newest), never none. The caller holds the project's lock.
  - `afterSave` (optional): `await afterSave({db, previous, version})` after
    both writes, `previous` being the current version before the save (the
    whole document; `null` for a new project). Its rejection reaches the
    caller, the version being saved already. Without it, the previous
    version isn't read.
- Unit specs in `project/versions.spec.js`, on the test MongoDB (microdraw's
  cases ported: the newest of two current versions, only backups, a
  non-string shortname, and the failure after the insert);
  `test/exports.spec.js` checks the new names.
- Nothing is renamed or removed; every 1.15.0 export is unchanged.

### What the apps must do

Nothing is required. When each app switches:

**microdraw** (M9b): `currentProject.js` keeps its exports and calls NWL.
`saveProjectVersion(db, doc, {by, keepModified, datasetOwner})` becomes:

```js
nwlSaveProjectVersion(db, doc, {
  by,
  keepModified,
  afterSave: ({ db, previous, version }) => recordDatasets(db, previous, version, datasetOwner || by || version.owner)
});
```

No change for it (the previous version is now read whole, where microdraw
read only `files.list`).

**BrainBox** (M9c): reads become
`findCurrentProject(nativeDb, shortname, {projection: {_id: 0}})`, and the
three writes (`postProject`, a new project, `replaceCurrentVersion`) become
`saveProjectVersion(nativeDb, version, {by})`. Behaviour changes for
BrainBox:
- the write order: insert, then mark the others backup (a failure between
  the two leaves two current versions instead of none);
- of two current versions, reads take the newest `_id` instead of an
  arbitrary one;
- `modified` and `modifiedBy` are set by the helper (unless
  `keepModified`) instead of by BrainBox before each write (the same values:
  an ISO string and the user).

## 1.15.0 — 2026-11

### New

- **The label set listing, exported from `require('neuroweblab')`** (stage 4,
  merge M8), in `routes/labelSets.js`. microdraw's
  `app/controller/api/labelsets.js` is the reference, with its default first
  (`10regions.json`) made an option.
  - `listLabelSets(dir, {first, logger})`: the `*.json` regular files of
    `dir`, read in parallel, as `[{name, source}]` (`source` is the file
    name). Sorted by file name (by code point, not `localeCompare`), with
    `first` (a file name, optional; ignored if absent) before the others. A
    file that isn't valid JSON, or has no string `name`, is skipped and logged
    with `logger.warn({err, file}, 'label set skipped: not a valid label set
    file')`; `logger` is `console` by default. A missing folder rejects. The
    folder is read on each call, and no path comes from the request.
  - `labelSetsRoute(dir, {first, logger})`: the Express handler of
    `GET /api/getLabelsets`, `res.json(await listLabelSets(dir, options))`,
    wrapped in `catchErrors` (an error answers 500 `{error: 'Server error'}`).
    It throws at creation if `dir` isn't a non-empty string.
- Unit specs in `routes/labelSets.spec.js` (microdraw's `listLabelSets` case
  from `test/api/label-sets.spec.js`, ported); `test/exports.spec.js` checks
  the new names.
- Nothing is renamed or removed; every 1.14.0 export is unchanged.

### What the apps must do

Nothing is required. When each app switches:

**microdraw** (M8b), in `app/controller/api/index.js`:

```js
router.get('/getLabelsets', labelSetsRoute(LABELS_DIR, { first: '10regions.json', logger: log }));
```

No change for it.

**BrainBox** (M8c):

```js
labelSetsRoute(path.join(__dirname, '../../public/labels'))
```

For BrainBox: name order instead of readdir order, an invalid file skipped
instead of answering 500, and only `*.json` files listed.

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
