# Conformance: the shared project-management suite

One suite, run by every app against its own server, asserting BrainBox's rules
(the reference). Slice 1 is the access matrix: owner, collaborator at each
level, `anyone` at each level, logged-in non-member, anonymous and token user,
on the project page, settings, JSON, `/files`, POST, DELETE, the `?page`
listing and the user's projects. HTTP only (Node's fetch); no browser, no
WebSocket.

## Adopting it

Add a test file that mocha loads **after** the file that starts the app
(e.g. `mocha test/runner.js test/conformance.test.js`). The suite uses that
server; it never starts one. The app must run with `LOCALSIGNIN=true`.

```js
const { accessMatrix } = require('neuroweblab/conformance');
const U = require('./utils');

accessMatrix({
  baseURL: () => U.serverURL,          // a function if the port is known late
  layer: { type: 'volume', values: 'foreground.json' }, // a layer the app accepts
  insertProject: (doc) => U.getNativeDB().collection('project').insertOne(doc),
  removeProject: (owner, shortname) => U.getNativeDB().collection('project').deleteMany({ shortname }),
  removeUser: (username) => U.getNativeDB().collection('user').deleteMany({ nickname: username }),
  routes: { files: null },             // only where the app's routes differ
  expectedDifferences: {
    'route:files': 'ledger "Paged project files route"',
    '1.5/status': 'inventory 1.5: 403, not 401'
  }
});
```

The adapter (`adapter.js`, JSDoc types): `baseURL`; `createUser(name)` (default:
`POST /localSignup`, `/localLogin`, `GET /token`); `anonymousClient()`;
`createProject(owner, spec)` (default: `POST /project/json/:p` with
`projectDocument()`, valid in both apps); `insertProject(doc)` (for the project
without an `anyone` row, which no app saves); `removeProject`, `removeUser`;
`routes` (BrainBox's by default, `null` = not routed); `expectedDifferences`.
The two adapters in use are in the coordination folder,
`tasks/shared-pm-tests-adapters/`.

## Expected differences

Each check belongs to a rule, named by its row in the feature map
(coordination `tasks/proposed-shared-pm-tests.md`): `1.1` … `1.15`, `2.1`,
`2.2`, `2.22`, `3.1`, `3.3`; `<row>/status` is the exact status code where only
the code differs (the refusal itself is checked under the rule). The list is
`RULES`. A case whose failing checks are all declared is reported as pending,
its title ending in `[known difference <rule>: …]`. A case with any other
failure fails. The last test, `every declared difference still differs`, fails
when a declared rule ran and never failed: remove it from the list. Titles
name the role, the levels and BrainBox's route, the same in every app.

## NeuroWebLab's own test

`conformance/accessMatrix.spec.js` runs the suite on `test/conformanceApp.js`
(NWL's auth and `AccessControlService`, BrainBox's rules), then on a variant
that does not hide the collaborators, in a nested mocha: the suite fails there.
