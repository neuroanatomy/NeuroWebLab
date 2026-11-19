/**
 * Slice 3 cases: a user's projects (`GET /user/json/:u/projects`). Which:
 * owned, or a row naming the user by `username` or `userID`, then `files:
 * view` for the visitor (3.3); `start`/`length` optional, filtered, then
 * sliced (3.4); the rows: counts of what the visitor may see, `modified`, an
 * empty list when there is none (3.5). Since NeuroWebLab 1.22.0: a row
 * naming the user by `nickname` only (3.16); `start` or `length` past the
 * end (3.17); a `start` or `length` that is not a string of digits counts as
 * not given (3.18); `GET /user/json/:u` answers only the public fields
 * (3.19).
 */

// what GET /user/json/:u may answer (NWL's publicUser: the username field and PUBLIC_USER_FIELDS)
const PUBLIC_KEYS = ['username', 'nickname', 'name', 'avatarURL', 'url', 'joined'];
const EMAIL_DOMAIN = '@conformance.example';

// eslint-disable-next-line max-lines-per-function, max-statements
module.exports = (t) => {
  const { describe, it, before, runCase, R } = t;
  const OUTSIDER = { key: 'outsider', via: 'session' };
  const MEMBER = { key: 'member', via: 'session' };
  const OWNER = { key: 'owner', via: 'session' };
  const ANONYMOUS = { key: null, via: 'none' };
  const sorted = (list) => [...list].sort();

  /* Whether the project is in the user's projects, as the visitor sees them */
  const listed = async (check, rule, visitor, userKey, projectKey) => {
    const { res, rows } = await t.userProjects(visitor, userKey);
    check(rule, Array.isArray(rows), `a list expected, got ${t.what(res)}`);

    return t.names(rows).includes(t.name(projectKey));
  };

  /* The row of a project in the owner's projects, as the visitor sees them, and the JSON route's collaborators */
  const rowAndJSON = async (visitor, projectKey) => {
    const { rows } = await t.userProjects(visitor, 'owner');
    const row = (rows || []).find((r) => r.shortname === t.name(projectKey));
    const { body } = await t.get(visitor, t.fill('json', { p: t.name(projectKey) }));
    const shown = (body && body.collaborators && Array.isArray(body.collaborators.list)) ? body.collaborators.list.length : -1;

    return { row, shown };
  };

  describe(`GET ${R.userProjects}: which projects (3.3)`, function () {
    const CASES = [
      ['the projects the user owns are listed', 'mown', true],
      ['a project with a row naming the user by userID only is listed', 'uid', true],
      ['a project with a row naming the user by username only is listed', 'uname', true],
      ['a project without the user is not listed', 'pub0', false]
    ];
    for (const [text, projectKey, expected] of CASES) {
      it(`logged-in non-member, the member's projects: ${text} (3.3)`, runCase('userProjects', async (check) => {
        const found = await listed(check, '3.3', OUTSIDER, 'member', projectKey);
        check('3.3', found === expected, expected ? 'not listed' : 'listed');
      }));
    }
    it('logged-in non-member, the member\'s projects: a project with a row naming the user by nickname only is listed (3.16)', runCase('userProjects', async (check) => {
      check('3.16', await listed(check, '3.16', OUTSIDER, 'member', 'unick'), 'not listed');
    }));
    it('logged-in non-member, the member\'s projects: a project only its members may view is not listed (3.3)', runCase('userProjects', async (check) => {
      check('3.3', !await listed(check, '3.3', OUTSIDER, 'member', 'priv0'), 'listed');
    }));
    it('member, their own projects: a project they may view as a member is listed (3.3)', runCase('userProjects', async (check) => {
      check('3.3', await listed(check, '3.3', MEMBER, 'member', 'priv0'), 'not listed');
    }));
  });

  describe(`GET ${R.userProjectsAll}: start and length optional, filtered, then sliced (3.4)`, function () {
    const visible = ['pg0', 'pg2', 'pg4', 'pg6'].map(t.name);

    it('anonymous: without start and length, every project of the user it may view (3.4)', runCase('userProjectsAll', async (check) => {
      const { res, rows } = await t.userProjects(ANONYMOUS, 'pager', 'userProjectsAll');
      check('3.4', res.status === 200 && Array.isArray(rows), `200 and a list expected, got ${t.what(res)}`);
      check('3.4', JSON.stringify(sorted(t.names(rows))) === JSON.stringify(visible), `${visible.join(', ')} expected, got ${t.names(rows).join(', ')}`);
    }));

    it(`anonymous: ${R.userProjectsRange} slices the projects it may view, 3 by 3 (3.4)`, runCase('userProjectsRange', async (check) => {
      const first = await t.userProjects(ANONYMOUS, 'pager', 'userProjectsRange', { start: 0, length: 3 });
      const second = await t.userProjects(ANONYMOUS, 'pager', 'userProjectsRange', { start: 3, length: 3 });
      const [a, b] = [t.names(first.rows), t.names(second.rows)];
      check('3.4', a.length === 3 && b.length === 1, `3 then 1 expected, got ${a.length} (${t.what(first.res)}) then ${b.length}`);
      check('3.4', JSON.stringify(sorted([...a, ...b])) === JSON.stringify(visible), `${visible.join(', ')} expected, got ${[...a, ...b].join(', ')}`);
    }));
  });

  describe(`GET ${R.userProjects}: the rows (3.5)`, function () {
    it('anonymous, the collaborators hidden: numFiles, and numCollaborators counts only the rows it may see (3.5)', runCase('userProjects', async (check) => {
      const { row, shown } = await rowAndJSON(ANONYMOUS, 'rows');
      check('3.5', Boolean(row), 'the project is not listed');
      if (row) {
        check('3.5', row.numFiles === 3, `numFiles 3 expected, got ${row.numFiles}`);
        check('3.5', row.numCollaborators === shown && shown < 3, `numCollaborators ${shown} expected (the JSON route's, of 3 rows), got ${row.numCollaborators}`);
      }
    }));

    it('member, the collaborators visible: numCollaborators counts every row (3.5)', runCase('userProjects', async (check) => {
      const { row, shown } = await rowAndJSON(MEMBER, 'rows');
      check('3.5', Boolean(row) && row.numCollaborators === 3 && shown === 3, `numCollaborators 3 expected, got ${row && row.numCollaborators} (JSON route: ${shown})`);
    }));

    it('owner: modified is there and not older than the last save (3.5)', runCase('userProjects', async (check) => {
      const { row } = await rowAndJSON(OWNER, 'rows');
      const modified = row ? Date.parse(row.modified) : NaN;
      // stored dates may keep whole seconds only
      const since = Math.floor(t.savedAt / 1000) * 1000;
      check('3.5', modified >= since, `modified at or after ${new Date(since).toJSON()} expected, got ${row && JSON.stringify(row.modified)}`);
    }));

    it('a user without projects: an empty list (3.5)', runCase('userProjects', async (check) => {
      const { res, rows } = await t.userProjects(OUTSIDER, 'outsider');
      check('3.5', Array.isArray(rows) && rows.length === 0, `an empty list expected, got ${t.what(res)}`);
    }));
  });

  describe(`GET ${R.userProjectsRange}: past the end (3.17), and a start or length that is not a count (3.18)`, function () {
    // pager's projects: 4 the anonymous visitor may view
    const range = (start, length) => t.userProjects(ANONYMOUS, 'pager', 'userProjectsRange', { start, length });
    const isList = (check, rule, { res, rows }, what) => check(rule, res.status === 200 && Array.isArray(rows), `${what}: 200 and a list expected, got ${t.what(res)}`);

    it('anonymous: a start at or past the end gives an empty list, a length past the end the rest (3.17)', runCase('userProjectsRange', async (check) => {
      for (const [start, length, expected] of [['4', '3', 0], ['100', '3', 0], ['100', '0', 0], ['3', '100', 1]]) {
        // eslint-disable-next-line no-await-in-loop
        const got = await range(start, length);
        isList(check, '3.17', got, `start=${start}&length=${length}`);
        const n = (got.rows || []).length;
        check('3.17', n === expected, `start=${start}&length=${length}: ${expected} expected, got ${n}`);
      }
    }));

    it('anonymous: a start that is not a string of digits (abc, -1, 1.5, empty) counts as not given (3.18)', runCase('userProjectsRange', async (check) => {
      const first = t.names((await range('0', '2')).rows);
      for (const start of ['abc', '-1', '1.5', '']) {
        // eslint-disable-next-line no-await-in-loop
        const got = await range(start, '2');
        isList(check, '3.18', got, `start=${start}`);
        const names = t.names(got.rows);
        check('3.18', names.length === 2 && JSON.stringify(names) === JSON.stringify(first), `start=${start}&length=2: the first 2 (${first.join(', ')}) expected, got ${names.join(', ')}`);
      }
    }));

    it('anonymous: a length that is not a string of digits (abc, -1, 1.5, empty) counts as not given (3.18)', runCase('userProjectsRange', async (check) => {
      const rest = t.names((await range('1', '100')).rows);
      for (const length of ['abc', '-1', '1.5', '']) {
        // eslint-disable-next-line no-await-in-loop
        const got = await range('1', length);
        isList(check, '3.18', got, `length=${length}`);
        const names = t.names(got.rows);
        check('3.18', names.length === 3 && JSON.stringify(names) === JSON.stringify(rest), `start=1&length=${length}: the 3 after the first (${rest.join(', ')}) expected, got ${names.join(', ')}`);
      }
    }));
  });

  describe(`GET ${R.user}: only the public fields (3.19)`, function () {
    before(async function () {
      await t.adapter.setUserFields(t.name('member'), { name: `Member ${t.prefix}`, email: `${t.name('member')}${EMAIL_DOMAIN}` });
    });

    for (const [role, visitor] of [['anonymous', ANONYMOUS], ['the user themself', MEMBER]]) {
      it(`${role}: the user, with their name, and no field outside the allow-list (3.19)`, runCase('user', async (check) => {
        const { res, body } = await t.get(visitor, t.fill('user', { u: t.name('member') }));
        const ok = res.status === 200 && body !== null && typeof body === 'object' && !Array.isArray(body);
        check('3.19', ok, `200 and an object expected, got ${t.what(res)}`);
        if (ok) {
          const extra = Object.keys(body).filter((k) => !PUBLIC_KEYS.includes(k));
          check('3.19', extra.length === 0, `fields outside the allow-list: ${extra.join(', ')}`);
          check('3.19', (body.username || body.nickname) === t.name('member') && body.name === `Member ${t.prefix}`, `the username and the name expected, got keys ${Object.keys(body).join(', ')}`);
        }
        check('3.19', !res.text.includes(EMAIL_DOMAIN), 'an email is in the answer');
      }));
    }
  });
};
