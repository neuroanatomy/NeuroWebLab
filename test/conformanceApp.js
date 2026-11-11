/**
 * A minimal app for the conformance suite's own test: NeuroWebLab's auth
 * (local sign-in, token) and AccessControlService, with project routes that
 * follow BrainBox's rules (the reference). Projects are kept in memory.
 * `broken` options turn single rules off, to show the suite fails then.
 */
const express = require('express');
const { AccessControlService: ACS, AccessLevel, AccessType, authTokenMiddleware } = require('../index');

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
  const copy = { ...project };
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
 * Add the project routes to an app on which NeuroWebLab's init() ran
 * @param {object} app The express app
 * @param {object} broken Rules to turn off, e.g. {collaborators: true}
 * @returns {Map} The projects, by shortname
 */
// eslint-disable-next-line max-statements, max-lines-per-function
const addProjectRoutes = (app, broken) => {
  const projects = new Map();
  const who = (req) => (req.user ? req.user.username : 'anonymous');
  const find = (req) => projects.get(req.params.p);

  app.get('/project/new', (req, res) => res.send(req.user ? 'new project' : 'Logging in is required to create a new project.'));
  app.get('/project/json', authTokenMiddleware, (req, res) => {
    const visible = [...projects.values()].filter((p) => ACS.canViewFiles(p, who(req)));
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
  app.post('/project/json/:p', authTokenMiddleware, (req, res) => {
    if (!req.user) {
      return res.status(403).json({ error: 'error', message: 'User not authenticated' });
    }
    const old = find(req);
    const doc = JSON.parse(JSON.stringify(req.body.data));
    if (old) {
      if (!ACS.canEditFiles(old, who(req))) {
        return res.status(403).json({ error: 'error', message: 'User does not have edit rights' });
      }
      ACS.preventUnauthorizedUpdates(doc, old, who(req));
      doc.modified = new Date().toJSON();
      doc.modifiedBy = who(req);
    }
    projects.set(req.params.p, doc);
    res.json({ success: true });
  });
  app.delete('/project/json/:p', authTokenMiddleware, (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false });
    }
    const p = find(req);
    if (!p) {
      return res.status(500).json({ success: false });
    }
    if (!ACS.canRemoveFiles(p, who(req))) {
      return res.status(403).json({ success: false });
    }
    projects.delete(req.params.p);
    res.json({ success: true });
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
    const list = [...projects.values()]
      .filter((p) => p.owner === req.params.u || p.collaborators.list.some((c) => c.userID === req.params.u))
      .filter((p) => ACS.canViewFiles(p, who(req)))
      .map((p) => ({ project: p.shortname, projectName: p.name, owner: p.owner }));
    res.json({ success: list.length > 0, list });
  });

  return projects;
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
