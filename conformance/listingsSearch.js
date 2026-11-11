/**
 * Slice 3 cases: search. Project search answers only projects the visitor
 * may view, at most 10, `{shortname, name}` (3.6); user search matches the
 * username or the name, at most 10, never an email or other private field
 * (3.7); the search text is taken literally, a non-string refused (3.8).
 */

const MAX_FOUND = 10;
const PRIVATE_KEYS = ['email', 'passhash', 'password', 'token'];
const EMAIL_DOMAIN = '@conformance.example';

// eslint-disable-next-line max-lines-per-function, max-statements
module.exports = (t) => {
  const { describe, it, before, runCase, R, prefix } = t;
  const ANONYMOUS = { key: null, via: 'none' };
  const MEMBER = { key: 'member', via: 'session' };
  const OUTSIDER = { key: 'outsider', via: 'session' };
  // a name that shares nothing with the usernames
  const nameTag = `Nm${prefix.slice(2)}x`;
  const nameOf = (key) => `${nameTag} Person ${key}`;

  const search = async (route, visitor, q) => {
    const { res, body } = await t.get(visitor, t.fill(route, { q }));

    return { res, rows: t.adapter.rows[route](body) };
  };
  const isList = (check, rule, { res, rows }) => check(rule, res.status === 200 && Array.isArray(rows), `200 and a list expected, got ${t.what(res)}`);
  const allNamed = (rows) => (rows || []).every((r) => r.name === `Conformance ${r.shortname}`);

  describe(`GET ${R.searchProjects}: only projects the visitor may view, at most ${MAX_FOUND} (3.6)`, function () {
    it(`anonymous: 12 public projects match, the first ${MAX_FOUND} are found, as {shortname, name} (3.6)`, runCase('searchProjects', async (check) => {
      const found = await search('searchProjects', ANONYMOUS, t.name('srch'));
      isList(check, '3.6', found);
      const names = t.names(found.rows);
      check('3.6', names.length === MAX_FOUND, `${MAX_FOUND} expected, got ${names.length}: ${names.join(', ')}`);
      check('3.6', names.every((s) => (/srch\d+$/).test(s)), `only public projects expected, got ${names.join(', ')}`);
      check('3.6', allNamed(found.rows), `{shortname, name} expected, got ${found.res.text.slice(0, 120)}`);
    }));

    for (const [role, visitor] of [['anonymous', ANONYMOUS], ['logged-in non-member', OUTSIDER]]) {
      it(`${role}: projects only their members may view are not found (3.6)`, runCase('searchProjects', async (check) => {
        const found = await search('searchProjects', visitor, t.name('srchp'));
        isList(check, '3.6', found);
        check('3.6', t.names(found.rows).length === 0, `none expected, got ${t.names(found.rows).join(', ')}`);
      }));
    }

    it('member: the projects they may view as a member are found (3.6)', runCase('searchProjects', async (check) => {
      const found = await search('searchProjects', MEMBER, t.name('srchp'));
      isList(check, '3.6', found);
      const names = [...t.names(found.rows)].sort();
      check('3.6', JSON.stringify(names) === JSON.stringify([0, 1, 2, 3].map((i) => t.name(`srchp${i}`))), `srchp0-3 expected, got ${names.join(', ')}`);
      check('3.6', allNamed(found.rows), `{shortname, name} expected, got ${found.res.text.slice(0, 120)}`);
    }));
  });

  describe(`GET ${R.searchUsers}: the username or the name, at most ${MAX_FOUND}, nothing private (3.7)`, function () {
    before(async function () {
      await Promise.all(Object.keys(t.users).map((key) => t.adapter.setUserFields(t.name(key), { name: nameOf(key), email: `${t.name(key)}${EMAIL_DOMAIN}` })));
    });

    const finds = (found, key) => (found.rows || []).some((r) => r.username === t.name(key) && r.name === nameOf(key));
    const nothingPrivate = (check, found) => {
      const keys = (found.rows ? JSON.parse(found.res.text) : []).flatMap((r) => Object.keys(r || {}));
      check('3.7', !found.res.text.includes(EMAIL_DOMAIN), 'an email is in the answer');
      check('3.7', !keys.some((k) => PRIVATE_KEYS.includes(k)), `private fields in the answer: ${[...new Set(keys)].join(', ')}`);
    };

    it('logged-in user: a part of a username finds the user, with their name, and nothing private (3.7)', runCase('searchUsers', async (check) => {
      const found = await search('searchUsers', OUTSIDER, t.name('member'));
      isList(check, '3.7', found);
      check('3.7', finds(found, 'member'), `${t.name('member')} expected, got ${found.res.text.slice(0, 120)}`);
      nothingPrivate(check, found);
    }));

    it('logged-in user: a part of a name finds the user, and nothing private (3.7)', runCase('searchUsers', async (check) => {
      const found = await search('searchUsers', OUTSIDER, `${nameTag} Person member`);
      isList(check, '3.7', found);
      check('3.7', finds(found, 'member'), `${t.name('member')} expected, got ${found.res.text.slice(0, 120)}`);
      nothingPrivate(check, found);
    }));

    it(`logged-in user: 11 usernames match, ${MAX_FOUND} are found, and nothing private (3.7)`, runCase('searchUsers', async (check) => {
      const found = await search('searchUsers', OUTSIDER, prefix);
      isList(check, '3.7', found);
      const names = (found.rows || []).map((r) => r.username);
      check('3.7', names.length === MAX_FOUND && names.every((u) => u.startsWith(prefix)), `${MAX_FOUND} of the slice's users expected, got ${names.length}: ${names.join(', ')}`);
      nothingPrivate(check, found);
    }));

    it('anonymous: a part of a name finds nothing private (3.7)', runCase('searchUsers', async (check) => {
      const found = await search('searchUsers', ANONYMOUS, nameTag);
      nothingPrivate(check, found);
    }));
  });

  describe('search text taken literally, a non-string refused (3.8)', function () {
    for (const [route, q] of [['searchUsers', prefix], ['searchProjects', t.name('srch')]]) {
      it(`GET ${R[route]}: "${q.replace(prefix, '<prefix>')}." and "(" match nothing, as text (3.8)`, runCase(route, async (check) => {
        for (const text of [`${q}.`, `${q}(`, `.*${q}`]) {
          // eslint-disable-next-line no-await-in-loop
          const found = await search(route, OUTSIDER, text);
          check('3.8', found.res.status === 200 && Array.isArray(found.rows) && found.rows.length === 0, `"${text}": 200 and none expected, got ${t.what(found.res)}`);
        }
      }));

      it(`GET ${R[route]}: q as an array or an object is refused 400 (3.8)`, runCase(route, async (check) => {
        for (const query of [(n) => `${n}=${q}&${n}=x`, (n) => `${n}[$ne]=x`]) {
          const path = t.rawQuery(route, query);
          check('3.8', path !== null, `the route has no "name=:q": ${t.adapter.routes[route]}`);
          if (path !== null) {
            // eslint-disable-next-line no-await-in-loop
            const { res } = await t.get(OUTSIDER, path);
            check('3.8', res.status === 400, `${path}: 400 expected, got ${t.what(res)}`);
          }
        }
      }));
    }
  });
};
