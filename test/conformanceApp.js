/**
 * A minimal app for the conformance suite's own test: NeuroWebLab's auth
 * (local sign-in, token) and AccessControlService, with project routes that
 * follow the suite's rules (slice 1: BrainBox's; slices 2 to 4: the approved
 * ones, test/conformanceSave.js for the save; slice 5's admin routes,
 * test/conformanceAdmin.js). Projects are kept in memory, as
 * versions, and so are annotations (a value per file of a project).
 * `broken` options turn single rules off, to show the suite fails then.
 */
const express = require('express');
const { AccessControlService: ACS, AccessLevel, AccessType, authTokenMiddleware } = require('../index');
const { clone, saveHandler } = require('./conformanceSave');
const { escapeRegex } = require('../db/escapeRegex');
const { annotationWriteHandler, mayAnnotate } = require('./conformanceAnnotations');

const isAnyone = (c) => c.userID === 'anyone' || c.username === 'anyone';
const { VIEW } = AccessLevel;
const PER_PAGE = 20;
const MAX_FOUND = 10;

/**
 * The project as the visitor may see it, decided on the stored project (1.10)
 * @param {object} project The stored project
 * @param {string} who The visitor or 'anonymous'
 * @param {object} broken The rules turned off
 * @returns {object} A filtered copy
 */
const projectForUser = (project, who, broken) => {
  const copy = clone(project);
  delete copy._id;
  if (!ACS.canViewCollaborators(project, who) && !broken.collaborators) {
    copy.collaborators = { list: project.collaborators.list.filter(isAnyone) };
    delete copy.modifiedBy;
  }
  for (const type of [AccessType.FILES, AccessType.ANNOTATIONS]) {
    if (!ACS.hasAccess(type, VIEW, project, who)) {
      copy[type] = { list: [] };
    }
  }

  return copy;
};

const page = (name, json) => `<html><body><script>\nconst ${name}=${JSON.stringify(json)};\n</script></body></html>`;

/**
 * The projects, as versions: the current one has no `backup`
 * @param {object} broken The rules turned off
 * @returns {object} The store
 */
const makeStore = (broken) => {
  let docs = [];
  let next = 0;
  const of = (p) => docs.filter((d) => d.shortname === p);
  const current = (p) => of(p).filter((d) => !d.backup)
    .pop();
  const insert = (doc) => {
    next += 1;
    const d = { _id: `v${next}`, ...clone(doc) };
    docs.push(d);

    return d;
  };

  const store = {
    annotations: [],
    insert,
    current,
    versions: (p) => clone(of(p)),
    last: (p) => of(p).pop(),
    lastBackup: (p) => of(p).filter((d) => d.backup)
      .pop(),
    // the current versions; `listBackups`: every version
    listed: () => docs.filter((d) => broken.listBackups || current(d.shortname) === d),
    saveVersion: (version) => {
      const d = insert(version);
      if (!broken.noBackupMark) {
        of(d.shortname).forEach((v) => { if (v !== d) { v.backup = true; } });
      }
    },
    markDeleted: (p) => of(p).forEach((v) => { v.backup = true; }),
    // the project's versions and annotations (the nested runs store the same shortnames again)
    removeAll: (p) => {
      docs = docs.filter((d) => d.shortname !== p);
      store.annotations = store.annotations.filter((a) => a.project !== p);
    }
  };

  return store;
};

/**
 * A user's projects (3.3-3.5): owned or a row by `userID` or `username`, then
 * `files: view`; `start`/`length` optional, sliced after filtering; counts of
 * what the visitor may see
 * @param {object} store The store
 * @param {object} broken The rules turned off
 * @param {function(object): string} who The visitor of a request
 * @returns {function} The handler
 */
const userProjectsHandler = (store, broken, who) => (req, res) => {
  const { u } = req.params;
  const { start, length } = req.query;
  if (broken.rangeRequired && (typeof start === 'undefined' || typeof length === 'undefined')) {
    return res.status(403).json({ error: 'Provide start and length' });
  }
  const from = typeof start === 'undefined' ? 0 : Number(start);
  const to = typeof length === 'undefined' ? Infinity : from + Number(length);
  const isMember = (c) => c.userID === u || (!broken.userIDOnly && c.username === u);
  let list = store.listed().filter((p) => p.owner === u || p.collaborators.list.some(isMember));
  const visible = (projects) => projects.filter((p) => ACS.canViewFiles(p, who(req)));
  list = broken.sliceBeforeFilter ? visible(list.slice(from, to)) : visible(list).slice(from, to);
  res.json({
    success: list.length > 0,
    list: list.map((p) => ({
      project: p.shortname,
      projectName: p.name,
      owner: p.owner,
      numFiles: p.files.list.length,
      numCollaborators: (broken.hiddenCollaboratorsCounted ? p : projectForUser(p, who(req), broken)).collaborators.list.length,
      ...(broken.noModified ? {} : { modified: p.modified })
    }))
  });
};

/* The search text, or a 400 answer (3.8); `regexSearch`: not escaped */
const searchText = (req, res, broken) => {
  const { q } = req.query;
  if (typeof q !== 'string' && !broken.nonStringAccepted) {
    res.status(400).json({ error: 'Provide the text to search for in q' });

    return null;
  }

  return broken.regexSearch ? q : escapeRegex(String(q));
};

/**
 * Project search (3.6): projects the visitor may view, the first 10, {shortname, name}
 * @param {object} store The store
 * @param {object} broken The rules turned off
 * @param {function(object): string} who The visitor of a request
 * @returns {function} The handler
 */
const projectSearchHandler = (store, broken, who) => (req, res) => {
  const text = searchText(req, res, broken);
  if (text === null) {
    return;
  }
  try {
    const re = new RegExp(text);
    const found = store.listed().filter((p) => re.test(p.shortname))
      .filter((p) => broken.privateInSearch || ACS.canViewFiles(p, who(req)));
    res.json(found.slice(0, MAX_FOUND).map((p) => ({ shortname: p.shortname, name: p.name })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * User search (3.7): the username or the name, at most 10, {username, name}
 * @param {object} broken The rules turned off
 * @param {function(object, number): Promise<Array<object>>} findUsers Users matching a filter
 * @returns {function} The handler
 */
const userSearchHandler = (broken, findUsers) => async (req, res) => {
  const text = searchText(req, res, broken);
  if (text === null) {
    return;
  }
  const filter = broken.usernameOnly
    ? { username: { $regex: text } }
    : { $or: [{ username: { $regex: text } }, { name: { $regex: text } }] };
  try {
    const users = await findUsers(filter, MAX_FOUND);
    res.json(users.map((x) => (broken.emailInUserSearch ? { username: x.username, name: x.name, email: x.email } : { username: x.username, name: x.name })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

/**
 * Add the project routes to an app on which NeuroWebLab's init() ran
 * @param {object} app The express app
 * @param {object} broken Rules to turn off, e.g. {collaborators: true}
 * @param {function(string): Promise<boolean>} userExists Whether a user exists
 * @param {function(object, number): Promise<Array<object>>} findUsers Users matching a MongoDB filter, at most n (3.7)
 * @returns {object} The store (makeStore)
 */
// eslint-disable-next-line max-statements, max-lines-per-function
const addProjectRoutes = (app, broken, userExists, findUsers) => {
  const store = makeStore(broken);
  const who = (req) => (req.user ? req.user.username : 'anonymous');
  const find = (req) => store.current(req.params.p);

  app.get('/project/new', (req, res) => res.send(req.user ? 'new project' : 'Logging in is required to create a new project.'));
  // filtered, then paged (3.2); `pageBeforeFilter`: paged, then filtered
  app.get('/project/json', authTokenMiddleware, (req, res) => {
    const n = Number(req.query.page);
    const onPage = (list) => list.slice(n * PER_PAGE, (n + 1) * PER_PAGE);
    const visible = (list) => list.filter((p) => ACS.canViewFiles(p, who(req)));
    const listed = broken.pageBeforeFilter ? visible(onPage(store.listed())) : onPage(visible(store.listed()));
    res.json(listed.map((p) => ({ project: p.shortname, projectName: p.name, owner: p.owner })));
  });
  app.get('/project/json/:p', authTokenMiddleware, (req, res) => {
    const p = find(req);
    if (!p) {
      return res.send();
    }
    if (!ACS.canViewFiles(p, who(req))) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    res.json(projectForUser(p, who(req), broken));
  });
  app.get('/project/json/:p/files', authTokenMiddleware, (req, res) => {
    const p = find(req);
    if (!p) {
      return res.status(404).json({ error: 'no project' });
    }
    if (!ACS.canViewFiles(p, who(req))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.json(p.files.list.slice(Number(req.query.start), Number(req.query.start) + Number(req.query.length)));
  });
  app.post('/project/json/:p', authTokenMiddleware, saveHandler(store, broken, userExists));
  app.delete('/project/json/:p', authTokenMiddleware, (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false });
    }
    const p = find(req);
    if (!p) {
      return res.status(broken.unknownDelete500 ? 500 : 404).json({ success: false });
    }
    if (!broken.noRemoveCheck && !ACS.canRemoveFiles(p, who(req))) {
      return res.status(403).json({ success: false });
    }
    store.markDeleted(req.params.p);
    if (!broken.keepAnnotations) {
      store.annotations.filter((a) => a.project === req.params.p).forEach((a) => { a.backup = true; });
    }
    res.json({ success: true });
  });
  // the annotations of a file in a project (`keepAnnotations`: also without the project, as microdraw's F5)
  app.get('/annotations/json', authTokenMiddleware, (req, res) => {
    const p = store.current(req.query.project);
    if (!p && !broken.keepAnnotations) {
      return res.status(404).json({ error: 'no project' });
    }
    if (p && !broken.noReadCheck && !mayAnnotate(p, who(req), broken.viewNeedsEdit ? AccessLevel.EDIT : VIEW, broken)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.json(store.annotations.filter((a) => a.project === req.query.project && a.source === req.query.source && !a.backup));
  });
  app.post('/annotations/json', authTokenMiddleware, annotationWriteHandler(store, broken, who));
  app.get('/project/:p', (req, res) => {
    const p = find(req);
    if (!p) {
      return res.status(404).send('Project Not Found');
    }
    if (!ACS.canViewFiles(p, who(req))) {
      return res.status(401).send('Authorization required');
    }
    res.send(page('projectInfo', { ...projectForUser(p, who(req), broken), files: { list: [] } }));
  });
  app.get('/project/:p/settings', (req, res) => {
    const p = find(req) || {
      shortname: req.params.p,
      owner: who(req),
      collaborators: { list: [{ userID: 'anyone', access: { collaborators: 'view', annotations: 'edit', files: 'view' } }] },
      files: { list: [] },
      annotations: { list: [] }
    };
    if (!ACS.canViewFiles(p, who(req))) {
      return res.status(401).send('Authorization required');
    }
    res.send(page('project', { ...projectForUser(p, who(req), broken), files: { list: [] } }));
  });
  app.get('/user/json/:u/projects', userProjectsHandler(store, broken, who));
  app.get('/search/json/projects', projectSearchHandler(store, broken, who));
  app.get('/api/userNameQuery', userSearchHandler(broken, findUsers));

  return store;
};

/**
 * @returns {object} An express app with JSON and form bodies
 */
const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  return app;
};

module.exports = { addProjectRoutes, makeApp };
