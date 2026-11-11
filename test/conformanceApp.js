/**
 * A minimal app for the conformance suite's own test: NeuroWebLab's auth
 * (local sign-in, token) and AccessControlService, with project routes that
 * follow the suite's rules (slice 1: BrainBox's; slice 2: the approved ones,
 * test/conformanceSave.js). Projects are kept in memory, as versions.
 * `broken` options turn single rules off, to show the suite fails then.
 */
const express = require('express');
const { AccessControlService: ACS, AccessLevel, AccessType, authTokenMiddleware } = require('../index');
const { clone, saveHandler } = require('./conformanceSave');

const isAnyone = (c) => c.userID === 'anyone' || c.username === 'anyone';
const { VIEW } = AccessLevel;

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

  return {
    annotations: [],
    insert,
    current,
    versions: (p) => clone(of(p)),
    last: (p) => of(p).pop(),
    // the current versions; `listBackups`: every version
    listed: () => docs.filter((d) => broken.listBackups || current(d.shortname) === d),
    saveVersion: (version) => {
      const d = insert(version);
      if (!broken.noBackupMark) {
        of(d.shortname).forEach((v) => { if (v !== d) { v.backup = true; } });
      }
    },
    markDeleted: (p) => of(p).forEach((v) => { v.backup = true; }),
    removeAll: (p) => { docs = docs.filter((d) => d.shortname !== p); }
  };
};

/**
 * Add the project routes to an app on which NeuroWebLab's init() ran
 * @param {object} app The express app
 * @param {object} broken Rules to turn off, e.g. {collaborators: true}
 * @param {function(string): Promise<boolean>} userExists Whether a user exists
 * @returns {object} The store (makeStore)
 */
// eslint-disable-next-line max-statements, max-lines-per-function
const addProjectRoutes = (app, broken, userExists) => {
  const store = makeStore(broken);
  const who = (req) => (req.user ? req.user.username : 'anonymous');
  const find = (req) => store.current(req.params.p);

  app.get('/project/new', (req, res) => res.send(req.user ? 'new project' : 'Logging in is required to create a new project.'));
  app.get('/project/json', authTokenMiddleware, (req, res) => {
    const visible = store.listed().filter((p) => ACS.canViewFiles(p, who(req)));
    const n = Number(req.query.page);
    res.json(visible.slice(n * 20, (n + 1) * 20).map((p) => ({ project: p.shortname, projectName: p.name, owner: p.owner })));
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
    if (p && !ACS.canViewAnnotations(p, who(req))) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.json(store.annotations.filter((a) => a.project === req.query.project && a.source === req.query.source && !a.backup));
  });
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
  app.get('/user/json/:u/projects', (req, res) => {
    const list = store.listed()
      .filter((p) => p.owner === req.params.u || p.collaborators.list.some((c) => c.userID === req.params.u))
      .filter((p) => ACS.canViewFiles(p, who(req)))
      .map((p) => ({ project: p.shortname, projectName: p.name, owner: p.owner }));
    res.json({ success: list.length > 0, list });
  });

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
