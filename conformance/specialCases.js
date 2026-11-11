/**
 * Slice 1 cases outside the matrix: unknown projects (1.6, 1.15), the
 * new-project page (1.14), `modifiedBy` (1.8), unknown tokens (1.12).
 */
const { defaultRoutes: R } = require('./adapter');

/**
 * The project document a settings page holds (`const project = {...};`)
 * @param {string} html The page
 * @returns {object|null} The document
 */
const settingsProject = (html) => {
  const match = html.match(/const project\s*=\s*(\{.*\});\s*\n/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
};

const isAnyone = (row) => row && (row.userID === 'anyone' || row.username === 'anyone' || row.nickname === 'anyone');

// eslint-disable-next-line max-lines-per-function
module.exports = ({ describe, it, C, names, users, runCase, request, fill }) => {
  const anonymous = { key: null, via: 'none' };
  const outsider = { key: 'outsider', via: 'session' };
  const unknown = () => names.project('unknown');
  const get = (visitor, route, values, token) => request(visitor, { token }, 'GET', fill(route, values));

  describe('unknown projects, the new-project page, modifiedBy, unknown tokens', function () {
    it(`anonymous: GET ${R.json} of an unknown project answers no project (1.6)`, runCase('json', async (check) => {
      const res = await get(anonymous, 'json', { p: unknown() }, true);
      check('1.6', res.status !== 500 && !res.text.includes('"owner"'), `no project expected, got ${res.status} ${res.text.slice(0, 80)}`);
      // decided 2026-11-11: 404 {error}, as the page and the files route
      const body = C.parse(res.text);
      check('1.6/status', res.status === 404 && Boolean(body) && typeof body.error === 'string', `404 {error} expected, got ${res.status} ${res.text.slice(0, 80)}`);
    }));
    it(`anonymous: GET ${R.page} of an unknown project is 404 (1.6)`, runCase('page', async (check) => {
      const res = await get(anonymous, 'page', { p: unknown() });
      check('1.6', res.status === 404, `404 expected, got ${res.status}`);
    }));
    it(`anonymous: GET ${R.files} of an unknown project is 404 (1.6)`, runCase('files', async (check) => {
      const res = await get(anonymous, 'files', { p: unknown(), n: 1 }, true);
      check('1.6', res.status === 404, `404 expected, got ${res.status}`);
    }));
    it(`logged-in non-member: GET ${R.settings} of an unknown project gives a new project they own, anyone view/edit/view (1.15)`, runCase('settings', async (check) => {
      const res = await get(outsider, 'settings', { p: unknown() });
      const project = settingsProject(res.text) || {};
      const anyone = ((project.collaborators && project.collaborators.list) || []).filter(isAnyone);
      check('1.15', res.status === 200 && project.owner === users.outsider.username, `200 and owner ${users.outsider.username} expected, got ${res.status} owner ${project.owner}`);
      const a = (anyone[0] && anyone[0].access) || {};
      check('1.15', anyone.length === 1 && a.collaborators === 'view' && a.annotations === 'edit' && a.files === 'view', `anyone view/edit/view expected, got ${JSON.stringify(anyone)}`);
      check('1.15', (project.files && project.files.list.length) === 0 && (project.annotations && project.annotations.list.length) === 0, 'empty files and annotations expected');
    }));
    it(`anonymous: GET ${R.newProject} asks to log in; logged-in non-member: does not (1.14)`, runCase('newProject', async (check) => {
      const loggedOut = await get(anonymous, 'newProject', {});
      const loggedIn = await get(outsider, 'newProject', {});
      check('1.14', loggedOut.status === 200 && loggedOut.text.includes('Logging in is required'), `the login request expected, got ${loggedOut.status}`);
      check('1.14', loggedIn.status === 200 && !loggedIn.text.includes('Logging in is required'), `the new-project page expected, got ${loggedIn.status}`);
    }));
    for (const route of ['json', 'page']) {
      it(`anonymous, project saved last by a hidden collaborator: GET ${R[route]} does not name them (modifiedBy, 1.8)`, runCase(route, async (check) => {
        const res = await get(anonymous, route, { p: names.project('savedBySecret') }, true);
        check('1.8', res.status === 200 && !res.text.includes(names.secret), `200 without the collaborator's name expected, got ${res.status}${res.text.includes(names.secret) ? ', name shown' : ''}`);
      }));
    }
    it(`unknown token: GET ${R.json} of the private project is refused, as logged out (1.12)`, runCase('json', async (check) => {
      const res = await request({ key: null, via: 'token', token: `${names.project('nosuchtoken')}` }, { token: true }, 'GET', fill('json', { p: names.project('private') }));
      C.refused(check, '1.12', res, 401);
    }));
    it(`unknown token: GET ${R.json} of a project anyone may view answers as logged out (1.12)`, runCase('json', async (check) => {
      const res = await request({ key: null, via: 'token', token: `${names.project('nosuchtoken')}` }, { token: true }, 'GET', fill('json', { p: names.project('public4') }));
      const body = C.parse(res.text) || {};
      const shown = ((body.collaborators && body.collaborators.list) || []).map(C.rowName);
      check('1.12', res.status === 200 && shown.length > 0 && shown.every((n) => n === 'anyone'), `200 with only anyone expected, got ${res.status} ${JSON.stringify(shown)}`);
    }));
  });
};
