/**
 * Slice 1 checks: one function per route, each given the visitor's request
 * and calling `check(rule, ok, what)` for every rule it asserts. The rule
 * ids are inventory rows (tasks/proposed-shared-pm-tests.md, feature map);
 * `<row>/status` is the exact status code where only the code differs.
 */
const { NFILES, can, fromOwnRowOnly, projects } = require('./matrix');

const REFUSED = [401, 403];

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
};

const rowName = (c) => (c && (c.userID || c.username || c.nickname)) || '';
const shortnameOf = (r) => (typeof r === 'string' ? r : (r && (r.project || r.shortname)) || '');

/**
 * The rule a visitor's access check belongs to
 * @param {object} c The case: {projectKey, visitor, base}
 * @returns {string} A rule id
 */
const accessRule = (c) => {
  if (c.visitor.key === 'owner') {
    return '1.1';
  }
  if (c.visitor.via === 'token') {
    return '1.11';
  }
  if (c.projectKey === 'noAnyone') {
    return '1.4';
  }
  if (c.visitor.key === 'low') {
    return '1.2';
  }

  return c.base;
};

/**
 * Refused: 401 or 403 (the access rule), and the exact code (`1.5/status`)
 * @param {function} check The check function
 * @param {string} rule The access rule
 * @param {object} res The response
 * @param {number} status The code expected
 * @returns {void}
 */
const refused = (check, rule, res, status) => {
  check(rule, REFUSED.includes(res.status), `refused expected, got ${res.status}`);
  if (REFUSED.includes(res.status)) {
    check('1.5/status', res.status === status, `status ${status} expected, got ${res.status}`);
  }
};

/*
 * No view right (1.5, decided 2026-11-11): 401 logged out ("who are you?"),
 * 403 logged in, by session or by token
 */
const noViewStatus = (who) => (who ? 403 : 401);

/**
 * What a visitor may see of a project, decided on the stored project
 * @param {object} c The case
 * @param {string|null} who The visitor's user key, null when logged out
 * @returns {object} What is visible, and the rules of the checks
 */
const sight = (c, who) => {
  const project = projects[c.projectKey];
  const collaborators = can(project, who, 'collaborators', 'view');
  const ownRowRule = (type, otherwise) => (!collaborators && fromOwnRowOnly(project, who, type) ? '1.10' : otherwise);

  return {
    files: can(project, who, 'files', 'view'),
    collaborators,
    annotations: can(project, who, 'annotations', 'view'),
    layerRule: ownRowRule('annotations', '1.9'),
    filesRule: (rule) => ownRowRule('files', rule)
  };
};

/* GET /project/:p and /project/:p/settings: only what the visitor may see is in the page */
const page = (c, res, check, names) => {
  const rule = accessRule(c);
  const s = sight(c, c.who);
  if (!s.files) {
    return refused(check, rule, res, noViewStatus(c.who));
  }
  check(rule, res.status === 200, `200 expected, got ${res.status}`);
  if (res.status === 200) {
    const shown = res.text.includes(names.secret);
    check('1.7', shown === s.collaborators, s.collaborators ? 'a collaborator is missing from the page' : 'a hidden collaborator is in the page');
    const layer = res.text.includes(names.layer);
    check(s.layerRule, layer === s.annotations, s.annotations ? 'the layer is missing from the page' : 'a hidden layer is in the page');
  }
};

/* GET /project/json/:p */
const json = (c, res, check, names) => {
  const rule = accessRule(c);
  const s = sight(c, c.who);
  if (!s.files) {
    return refused(check, rule, res, noViewStatus(c.who));
  }
  check(rule, res.status === 200, `200 expected, got ${res.status}`);
  const body = parse(res.text) || {};
  const list = (part) => (body[part] && Array.isArray(body[part].list) ? body[part].list : []);
  const shown = list('collaborators').map(rowName);
  if (s.collaborators) {
    check('1.7', shown.includes(names.secret) && shown.length === names.rows(c.projectKey), `all collaborators expected, got ${JSON.stringify(shown)}`);
  } else {
    check('1.7', shown.every((n) => n === 'anyone') && !res.text.includes(names.secret), `only anyone expected, got ${JSON.stringify(shown)}`);
  }
  check(s.layerRule, list('annotations').length === (s.annotations ? 1 : 0), `${s.annotations ? 1 : 0} layer expected, got ${list('annotations').length}`);
  check(s.filesRule(rule), list('files').length === NFILES, `${NFILES} files expected, got ${list('files').length}`);
};

/* GET /project/json/:p/files */
const files = (c, res, check) => {
  const rule = accessRule(c);
  const s = sight(c, c.who);
  if (!s.files) {
    return refused(check, rule, res, noViewStatus(c.who));
  }
  const body = parse(res.text);
  check(s.filesRule(rule), res.status === 200 && Array.isArray(body) && body.length === NFILES, `200 and ${NFILES} files expected, got ${res.status} ${res.text.slice(0, 80)}`);
};

/* GET /project/json?page and /user/json/:u/projects: listed if the files may be viewed */
const listed = (c, found, check) => {
  const s = sight(c, c.who);
  check(accessRule(c), found === s.files, s.files ? 'the project is not listed' : 'a project the visitor may not view is listed');
};

/* POST /project/json/:p, the stored document sent back unchanged */
const save = (c, res, check) => {
  if (!c.who) {
    check('2.1', REFUSED.includes(res.status), `refused expected, got ${res.status}`);
    // approved 2026-11-11 (slice 2 rules): 401, as 1.5's "who are you?"
    check('2.1/status', res.status === 401, `401 expected, got ${res.status}`);

    return;
  }
  if (!can(projects[c.projectKey], c.who, 'files', 'edit')) {
    check('2.2', res.status === 403, `403 expected, got ${res.status}`);

    return;
  }
  check('2.2', res.status === 200 && (parse(res.text) || {}).success === true, `200 and success expected, got ${res.status} ${res.text.slice(0, 80)}`);
};

/* DELETE /project/json/:p (refused); an allowed delete runs on a copy */
const remove = (c, res, check) => {
  if (!c.who) {
    return check('2.22', res.status === 401, `401 expected, got ${res.status}`);
  }
  if (!can(projects[c.projectKey], c.who, 'files', 'remove')) {
    return check('2.22', res.status === 403, `403 expected, got ${res.status}`);
  }
  check('2.22', res.status === 200 && (parse(res.text) || {}).success === true, `200 and success expected, got ${res.status} ${res.text.slice(0, 80)}`);
};

module.exports = { files, json, listed, noViewStatus, page, parse, refused, remove, rowName, save, shortnameOf };
