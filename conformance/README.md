# Conformance: the shared project-management suite

One suite, run by every app against its own server, asserting BrainBox's rules
(the reference) unless the maintainer decided otherwise. Slice 1 is the
access matrix: owner, collaborator at each level, `anyone` at each level,
logged-in non-member, anonymous and token user,
on the project page, settings, JSON, `/files`, POST, DELETE, the `?page`
listing and the user's projects. HTTP only (Node's fetch); no browser, no
WebSocket.

## Adopting it

Add a test file that mocha loads **after** the file that starts the app
(e.g. `mocha test/runner.js test/conformance.test.js`). The suite uses that
server; it never starts one. The app must run with `LOCALSIGNIN=true`.

```js
const { accessMatrix, projectLifecycle, projectListings } = require('neuroweblab/conformance');
const U = require('./utils');

const adapter = {
  baseURL: () => U.serverURL,          // a function if the port is known late
  layer: { type: 'volume', values: 'foreground.json' }, // a layer the app accepts
  insertProject: (doc) => U.getNativeDB().collection('project').insertOne(doc),
  removeProject: (owner, shortname) => U.getNativeDB().collection('project').deleteMany({ shortname }),
  removeUser: (username) => U.getNativeDB().collection('user').deleteMany({ nickname: username }),
  routes: { files: null, searchProjects: null }, // only where the app's routes differ
  versions: (shortname) => U.getNativeDB().collection('project').find({ shortname }, { sort: { _id: 1 } }).toArray(),
  annotations: { add: (owner, shortname, file) => { /* store one */ }, readable: async (user, shortname, file) => true },
  setUserFields: (username, fields) => U.getNativeDB().collection('user').updateOne({ nickname: username }, { $set: fields }),
  expectedDifferences: {
    'route:files': 'ledger "Paged project files route"',
    '1.5/status': 'inventory 1.5: 403, not 401'
  }
};

accessMatrix(adapter);
projectLifecycle(adapter);
projectListings(adapter);
```

The adapter (`adapter.js`, JSDoc types): `baseURL`; `createUser(name)` (default:
`POST /localSignup`, `/localLogin`, `GET /token`); `anonymousClient()`;
`createProject(owner, spec)` (default: `POST /project/json/:p` with
`projectDocument()`, valid in both apps); `insertProject(doc)` (for the project
without an `anyone` row, which no app saves); `removeProject`, `removeUser`;
`routes` (BrainBox's by default, `null` = not routed); `expectedDifferences`.
Slice 2 also uses `versions`, `annotations` and `fileList`, slice 3
`setUserFields` and `rows` (below).
The two adapters in use are in the coordination folder,
`tasks/shared-pm-tests-adapters/`.

## Expected differences

Each check belongs to a rule, named by its row in the feature map
(coordination `tasks/proposed-shared-pm-tests.md`): `1.1` … `1.15`, `2.1`,
`2.2`, `2.22`, `3.1`, `3.3` (slice 1), `2.1` … `2.25` (slice 2, but 2.11 and
2.21), `3.1` … `3.8` (slice 3); `<row>/status` is the exact status code where only
the code differs (the refusal itself is checked under the rule). The list is
`RULES`. A case whose failing checks are all declared is reported as pending,
its title ending in `[known difference <rule>: …]`. A case with any other
failure fails. The last test, `every declared difference still differs`, fails
when a declared rule ran and never failed: remove it from the list. A rule
two slices check (3.1 and 3.3 in slices 1 and 3; 2.1, 2.2, 2.22 in slices 1
and 2) is judged once, by the last slice defined with the same adapter
object, on both slices' cases. Titles
name the role, the levels and BrainBox's route, the same in every app.

## Slice 2: create, save, delete, validation, versions

`projectLifecycle(adapter)`, with the same adapter. The rules are the ones
the maintainer approved on 2026-11-11 (coordination
`tasks/proposed-shared-pm-tests.md`, "Slice 2: rules for the differing
rows"); where both apps agreed (2.2, 2.3, 2.7, 2.16, 2.19, 2.22), the shared
rule. Every case is a POST, DELETE or read over HTTP by users the slice signs
up (owner, a non-member, and collaborators with view, edit, add, and files
edit only); the stored state is read back as the owner, from
`GET /project/json/:p`. Each refusal of an invalid document also checks the
answer, 400 `{error}` (2.13). Not in the slice: 2.11 (the files' shape: the
slice reads them through `fileList`), 2.21 (`filesLoaded`, BrainBox's), the
lock itself (2.20: only the outcome of two saves at once).

What it needs from the app, besides slice 1's fields:

- `versions(shortname)`: every stored document of the shortname, current and
  backups, oldest first (2.15, 2.16, 2.20);
- `annotations.add(owner, shortname, file)`, `annotations.readable(user,
  shortname, file)`: store an annotation of the project on one of its files,
  and tell whether the app's routes still let the user read it (2.24; how a
  deleted project's annotations are kept is the app's);
- `removeUser` that removes the user (2.9: a stored row of a removed user);
- `fileList(project)` if the JSON route's files are neither strings nor
  `{source, name}`.

A field it lacks fails the cases that need it, naming the field.

## Slice 3: listings and search

`projectListings(adapter)`, with the same adapter. The rules are the ones
the maintainer approved on 2026-11-11 (coordination
`tasks/proposed-shared-pm-tests.md`, "Slice 3: rules for the differing
rows"). The slice signs up 11 users and stores 68 projects (directly, by
`insertProject`, in an order that mixes the hidden ones in; one over HTTP
for `modified`):

- `GET ?page` (3.1, 3.2), anonymous, a member, the member by token: every
  page read until an empty one; no project the visitor may not view; 20 per
  page, every page full but the last, no project twice, every project it may
  view listed (25 public, 8 the member may view, 8 only the owner may);
- a user's projects (3.3-3.5): owned, a row by `userID` only, a row by
  `username` only, then `files: view` for the visitor; without `start` and
  `length` (route `userProjectsAll`), and sliced 3 by 3 after filtering
  (`userProjectsRange`); `numFiles`, `numCollaborators` = the rows the JSON
  route shows the visitor (no count of hidden collaborators), `modified` not
  older than the last save; an empty list for a user without projects;
- project search (3.6, route `searchProjects`): only projects the visitor
  may view, the first 10 of 12 matches (4 private ones stored first),
  `{shortname, name}`. BrainBox has none (`searchProjects: null`): the 3.6
  cases are skipped, reported as not routed;
- user search (3.7, route `searchUsers`): a part of a username, a part of a
  name, at most 10 of 11 matches; no email (stored by `setUserFields`),
  `passhash`, `password` or `token` in any answer;
- literal search text and a non-string `q` (3.8): `x.`, `x(`, `.*x` match
  nothing, `q=a&q=b` and `q[$ne]=x` are 400, on both searches.

Not in the slice: 3.9, 3.10 (app-specific), and the new-project "is this
shortname taken?" check of 3.6 (BrainBox's is over the WebSocket).

What it needs from the app, besides slices 1 and 2's fields:

- `setUserFields(username, fields)`: store `{name, email}` on a user made
  by `createUser` (3.7);
- `rows` (optional): `{list, userProjects, searchProjects, searchUsers}`,
  each `(parsed answer) => rows | null`, the rows as `{shortname}`,
  `{shortname, numFiles, numCollaborators, modified}`, `{shortname, name}`
  and `{username, name}`. The defaults read BrainBox's (`project`,
  `nickname`, `{success, list}`) and microdraw's (shortname strings,
  `shortname`, `username`) shapes;
- `routes`: `searchProjects` (default microdraw's
  `/search/json/projects?q=:q`), `searchUsers` (default BrainBox's
  `/api/userNameQuery?q=:q`), `userProjectsAll`, `userProjectsRange`.

## NeuroWebLab's own test

`conformance/accessMatrix.spec.js` runs slice 1 on `test/conformanceApp.js`
(NWL's auth and `AccessControlService`, BrainBox's rules), then on a variant
that does not hide the collaborators, in a nested mocha: the suite fails there.
`conformance/projectLifecycle.spec.js` runs slice 2 on the same app (its save
is `test/conformanceSave.js`, the approved rules), then on 23 variants, each
turning one rule off (owner from the client, stored fields lost, invalid
document 500, …): each makes its rule fail, and no other rule outside the
ones it breaks. `conformance/projectListings.spec.js` does the same for
slice 3 with 11 variants (page before filtering, a row by `userID` only,
`start`/`length` required, sliced before filtering, hidden collaborators
counted, no `modified`, private projects in search, user search by
username only, an email in user search, regex search text, a non-string
`q` accepted), a missing route, and a rule two slices check. `test/conformanceHarness.js` starts the app for both.
