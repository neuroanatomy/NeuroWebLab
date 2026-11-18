/**
 * Slice 2 cases: deleting. A refused delete leaves the project (2.22); an
 * unknown project is 404 (2.23); a deleted project is gone from every read,
 * its annotations too (2.24, how they are kept is the app's); a new project
 * reusing the shortname starts empty (2.25). Since NeuroWebLab 1.21.0 (its
 * delete route wrapper, routes/projectAccess.js, decision D4 B): the bodies
 * of the logged-out (2.31), unknown-project (2.32) and refused (2.33) deletes,
 * `{success: false, error, message}`, the reason in both.
 */

/**
 * Check a refused delete's body: `{success: false, error: reason, message: reason}`
 * @param {function} check The check function
 * @param {string} rule The rule
 * @param {object} res The response
 * @param {number} status The status expected
 * @param {string} reason The reason expected
 * @returns {void}
 */
const refusal = (check, rule, res, status, reason) => {
  let body = {};
  try {
    body = JSON.parse(res.text) || {};
  } catch (e) {
    body = {};
  }
  const ok = res.status === status && body.success === false && body.error === reason && body.message === reason;
  check(rule, ok, `${status} {success: false, error: '${reason}', message: '${reason}'} expected, got ${res.status} ${res.text.slice(0, 120)}`);
};

// eslint-disable-next-line max-lines-per-function
module.exports = (t) => {
  const { describe, it, runCase, users, adapter, R } = t;

  /* Gone from the JSON route, the page, the settings and the user's projects */
  const gone = async (check, rule, shortname, name) => {
    check(rule, !t.exists(await t.json(shortname)), 'JSON: the project is still there');
    const page = await t.page(shortname);
    check(rule, page.status === 404, `page: 404 expected, got ${page.status}`);
    const settings = await t.settings(shortname);
    check(rule, !settings.text.includes(name), 'settings: the project is still there');
    const times = await t.listed(shortname);
    check(rule, times === 0, `user projects: not listed expected, listed ${times} times`);
  };

  describe('delete: refused, unknown, what is left, the shortname reused', function () {
    it(`collaborator with files add: DELETE ${R.remove} is refused 403, the project stays (2.22)`, runCase('remove', async (check) => {
      const { shortname, doc } = await t.create('keep');
      const res = await t.remove(users.adder, shortname);
      check('2.22', res.status === 403, `403 expected, got ${res.status}`);
      check('2.22', (await t.json(shortname)).name === doc.name, 'the project is gone');
    }));

    it(`owner: DELETE ${R.remove} of an unknown project is 404 (2.23)`, runCase('remove', async (check) => {
      const res = await t.remove(users.owner, t.name('neverStored'));
      check('2.23', res.status === 404, `404 expected, got ${res.status}`);
    }));

    it(`anonymous: DELETE ${R.remove} answers 401 {success: false, error: 'User not authenticated', message: …}, the project stays (2.31)`, runCase('remove', async (check) => {
      const { shortname, doc } = await t.create('keepLoggedOut');
      refusal(check, '2.31', await t.removeLoggedOut(shortname), 401, 'User not authenticated');
      check('2.31', (await t.json(shortname)).name === doc.name, 'the project is gone');
    }));

    it(`owner: DELETE ${R.remove} of an unknown project answers 404 {success: false, error: 'Project not found', message: …} (2.32)`, runCase('remove', async (check) => {
      refusal(check, '2.32', await t.remove(users.owner, t.name('neverStoredEither')), 404, 'Project not found');
    }));

    it(`collaborator with files add: DELETE ${R.remove} answers 403 {success: false, error: 'The user is not allowed to delete this project', message: …} (2.33)`, runCase('remove', async (check) => {
      const { shortname } = await t.create('keepRefused');
      refusal(check, '2.33', await t.remove(users.adder, shortname), 403, 'The user is not allowed to delete this project');
    }));

    it('owner: after a delete the project is gone from every read, and its annotations cannot be read (2.24)', runCase('remove', async (check) => {
      const { shortname, doc } = await t.create('deleted');
      const [file] = doc.files.list;
      await adapter.annotations.add(users.owner, shortname, file);
      check('2.24', await adapter.annotations.readable(users.owner, shortname, file), 'the annotation cannot be read before the delete (adapter.annotations)');
      const res = await t.remove(users.owner, shortname);
      check('2.24', res.status === 200, `200 expected, got ${res.status} ${res.text.slice(0, 80)}`);
      await gone(check, '2.24', shortname, doc.name);
      check('2.24', !await adapter.annotations.readable(users.owner, shortname, file), 'the annotation can still be read');
    }));

    it('a new project reusing the shortname of a deleted one starts empty (2.25)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('reused', { extra: { name: 'Old life', description: 'Old description' } });
      await t.save(users.owner, shortname, { ...doc, name: 'Old life again' });
      check('2.25', (await t.remove(users.owner, shortname)).status === 200, 'delete: 200 expected');
      const fresh = t.document(shortname, { files: 0, extra: { name: 'New life' } });
      fresh.files.list.push(t.file(shortname, 'new'));
      const res = await t.save(users.owner, shortname, fresh);
      const stored = await t.json(shortname);
      check('2.25', res.status === 200 && stored.name === 'New life', `200 and the new project expected, got ${res.status} ${stored.name}`);
      check('2.25', typeof stored.description === 'undefined' && JSON.stringify(t.sources(stored)) === JSON.stringify([fresh.files.list[0].source]), `nothing of the old project expected, got ${JSON.stringify(stored.description)} ${JSON.stringify(t.sources(stored))}`);
      const pages = await Promise.all([t.page(shortname), t.settings(shortname)]);
      check('2.25', pages.every((p) => !p.text.includes('Old life')), 'the old project is in the page or the settings');
    }));
  });
};
