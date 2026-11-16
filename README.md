# NeuroWebLab
NeuroWebLab backend

Your portal for collaborative open neuroscience on the web.  

Come check out our vision [here](https://neuroweblab.github.io/).  

<img src="./images/Neuroweblab.png"></img>

## Helpers

Small functions the apps share, exported from `require('neuroweblab')` (since 1.8.0):

- `escapeRegex(str)`: user text matched literally in a MongoDB `$regex`.
- `jsonForScript(value)`, `jsonForAttribute(value)`: JSON to write into an inline `<script>` (`<`, `>`, `&`, U+2028, U+2029 escaped), or into a single-quoted attribute (`'` too).
- `toId(id)`: the `ObjectId` of a 24-digit hex string in either case, else `null`.
- `catchErrors(handler, respond)`: wraps an async Express handler; an error answers 500 `{error: 'Server error'}` (or `respond(res)`) unless headers were sent, and is logged with `req.log` or `console`.
- `usernameFromCookie(sessionParser, cookie)`: the username of the session a WebSocket's cookie belongs to, or `null`; reads `username` and the configured `usernameField`.
- Saving a project (since 1.9.0, `project/save.js`): `canSaveProject(oldProject, user)` (edit on at least one list), `keepFieldsWithoutFilesEdit(newProject, oldProject, user, {sanitize})` (the project's own fields need `files: edit`), `saveRefusal()` (the 403 body), `ignoredChangesMessage(ignored)` (the "Some changes (on …) were ignored" text), `filesListIncomplete(newProject, oldProject, dropped)` (a files list sent before every file was loaded).
- Validating a project (since 1.10.0, `project/rules.js`): `plainText(str)` (markup removed by DOMPurify over jsdom, text kept), `sanitize(value)` (every string of a JSON value, as `plainText`), `isBlank(v)`, `text(v)`, `listOf(project, type)`, `isBlankRow` (blank rows by list), `sortRows(type, rows, oldRows, {rowKey, isBlankRow})` (stored, new and blank rows; `rowKey` is the app's), `shortnamePattern` (a new shortname: letters, numbers, hyphens), `droppedMessage(dropped)` (the "Empty rows were not saved" text).

They live in `util/` (and `auth/sessionUser.js`, `project/`), each with its spec next to it.

## Yearly Node upgrade

All NAAT repos (NeuroWebLab, nwl-components, BrainBox, microdraw) run the current Node LTS, declared in each repo's `.nvmrc`. The workflow `.github/workflows/yearly-node-upgrade.yml` runs on the 1st of every month. Each run re-enables the workflow through the GitHub API, so the schedule isn't disabled after 60 days without commits; outside November that's all it does ("keepalive only"). The issue is still yearly: in November it finds the newest Node LTS on nodejs.org, checks that the unofficial `linux-x64-glibc-217` builds exist for it (the production servers run CentOS 7), and, if that LTS is newer than `.nvmrc`, opens an issue labelled `node-upgrade` with the checklist for the four repos and both servers (deadline: 1 May). It doesn't open a second issue while one is still open, and it only logs a line when the repos are already on the newest LTS.

- **Who gets assigned:** set the repository variable `NODE_UPGRADE_ASSIGNEES` to a comma-separated list of GitHub usernames (Settings → Secrets and variables → Actions → Variables). Assignees must be collaborators of this repo. If the variable is empty, the issue is opened unassigned and says so.
- **Run it by hand:** Actions → Yearly Node upgrade → Run workflow. A manual run does the Node check in any month ("Run the Node check" is ticked; untick it for a keepalive only). "Dry run" is ticked by default: the log shows the issue it would open, and nothing is created. Untick it to open the issue now.
- **Locally:** `NODE_CHECK=true DRY_RUN=true node .github/scripts/yearly-node-upgrade.mjs` (add `NVMRC=<file containing an older major>` to see the issue text).
