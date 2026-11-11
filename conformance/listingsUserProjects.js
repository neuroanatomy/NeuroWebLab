/**
 * Slice 3 cases: a user's projects (`GET /user/json/:u/projects`). Which:
 * owned, or a row naming the user by `username` or `userID`, then `files:
 * view` for the visitor (3.3); `start`/`length` optional, filtered, then
 * sliced (3.4); the rows: counts of what the visitor may see, `modified`, an
 * empty list when there is none (3.5).
 */

// eslint-disable-next-line max-lines-per-function, max-statements
module.exports = (t) => {
  const { describe, it, runCase, R } = t;
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
};
