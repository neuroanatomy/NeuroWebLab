/**
 * Slice 5's damaged projects cases (NeuroWebLab 1.23.0, stage 4 merge M16,
 * decision D6 option A), run by projectAdmin.js:
 * - 5.6 a restore-files or a fix-current with a stale version token is a 409
 *   and stores nothing (no new version, no version changed, no log entry);
 *   the token the list gave is accepted by fix-current;
 * - 5.7 a restore-files with the token the list gave adds the missing rows
 *   back, after the current ones, with their names, as a new current
 *   version; every earlier version kept unchanged, as a backup (5.4's rule).
 *
 * The slice stores a damaged project with `insertProject`, one document per
 * version, oldest first (an earlier one with `backup: true`), as the other
 * slices store projects directly; it reads the app's damaged list as the
 * admin, then posts the fix. The routes, the list's entries and the bodies
 * are microdraw's by default; `admin.damaged` maps another app's.
 */
const { uniform } = require('./matrix');
const { projectDocument } = require('./adapter');

const what = (res) => `${res.status} ${res.text.slice(0, 120)}`;
const id = (v) => String(v._id);
// a version as stored, but its `backup` mark
const content = (v) => {
  const copy = { ...v };
  delete copy.backup;

  return JSON.stringify(copy);
};

/**
 * A token that is not the one given: its first digit changed (a made-up one
 * if none was given)
 * @param {*} token The token of the list
 * @returns {string} Another token
 */
const staleToken = (token) => {
  if (typeof token !== 'string' || token === '') {
    return '00000000000000000000';
  }

  return `${token[0] === '0' ? '1' : '0'}${token.slice(1)}`;
};

/**
 * The documents of a project's versions, oldest first: each a projectDocument
 * with 3 files named `Damaged file <i>` (not their file names), the files of
 * each version given by index
 * @param {object} t The slice's helpers
 * @param {string} shortname The project
 * @param {Array<Array<number>>} filesOf The files of each version
 * @returns {Array<object>} The documents, every one but the last `backup: true` if `backups`
 */
const versionDocuments = (t, shortname, filesOf) => {
  const spec = { shortname, anyone: uniform('view'), collaborators: [], files: 3, layer: 'Layer' };
  const doc = projectDocument(t.users.member, spec, t.adapter.layer);
  const rows = doc.files.list.map((f, i) => ({ ...f, name: `Damaged file ${i}` }));

  return filesOf.map((indexes) => ({ ...doc, files: { list: indexes.map((i) => ({ ...rows[i] })) } }));
};

/**
 * Store a project's versions, oldest first
 * @param {object} t The slice's helpers
 * @param {Array<object>} docs The versions
 * @param {boolean} backups Whether the versions before the last are backups
 * @returns {Promise<void>} Resolves once stored
 */
const storeVersions = async (t, docs, backups) => {
  for (const [i, doc] of docs.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await t.adapter.insertProject(backups && i < docs.length - 1 ? { ...doc, backup: true } : doc);
  }
};

/**
 * The entry of a project in the app's damaged list, read as the admin
 * @param {object} t The slice's helpers
 * @param {string} shortname The project
 * @returns {Promise<object>} { entry: {shortname, version, saves} or null, res }
 */
const listedEntry = async (t, shortname) => {
  const { damaged } = t.admin;
  const res = await t.users.admin.client.get(damaged.list);
  let body = null;
  try {
    body = JSON.parse(res.text);
  } catch (err) {
    body = null;
  }
  const list = body && Array.isArray(body.list) ? body.list : [];
  const entry = list.map(damaged.entry).find((e) => e && e.shortname === shortname) || null;

  return { entry, res };
};

/**
 * 5.6, 5.7: the damaged projects fixes
 * @param {object} t The slice's helpers
 * @returns {void}
 */
// eslint-disable-next-line max-lines-per-function
const damagedCases = (t) => {
  const { describe, it, runCase, admin, adapter } = t;
  const post = (path, json) => t.users.admin.client.post(path, { json });
  const logCount = (shortname) => admin.logEntries(shortname);

  /* Store a project whose second save removed file 2, and read its entry */
  const lostAFile = async (key) => {
    const shortname = t.track(t.name(key));
    await storeVersions(t, versionDocuments(t, shortname, [[0, 1, 2], [0, 1]]), true);
    const before = await adapter.versions(shortname);
    const { entry, res } = await listedEntry(t, shortname);

    return { shortname, before, entry, res, save: before.length > 1 ? id(before[before.length - 1]) : null };
  };

  /* Whether the entry lists the save that removed the file, else the failure */
  const listed = (rule, check, damage) => {
    const ok = Boolean(damage.entry) && Array.isArray(damage.entry.saves) && damage.entry.saves.includes(damage.save);
    check(rule, ok, `the project and the save that removed a file are not in the damaged list: GET ${admin.damaged.list} ${what(damage.res)}`);

    return ok;
  };

  /* Every version as before (no new one, none changed), and no log entry added */
  const nothingStored = async (check, shortname, before, logBefore) => {
    const after = await adapter.versions(shortname);
    check('5.6', after.length === before.length, `no new version expected, ${before.length} before, ${after.length} after`);
    check('5.6', after.every((v, i) => before[i] && id(v) === id(before[i]) && content(v) === content(before[i]) && Boolean(v.backup) === Boolean(before[i].backup)), 'a stored version changed');
    const logAfter = await logCount(shortname);
    check('5.6', logAfter === logBefore, `no log entry expected, ${logAfter - logBefore} added`);
  };

  /* 5.4's rule: every earlier version kept, unchanged but its backup mark */
  const keptAsBackups = (check, before, after) => {
    for (const b of before) {
      const kept = after.find((v) => id(v) === id(b));
      check('5.7', Boolean(kept) && kept.backup === true && content(kept) === content(b), `version ${id(b)} was not kept unchanged as a backup`);
    }
  };

  describe('5.6 a damaged project fix with a stale version token: 409, nothing stored', function () {
    it('restore-files with a token that is not the current one: 409; no version stored or changed, no log entry (5.6)', runCase('admin', async (check) => {
      const damage = await lostAFile('stalerestore');
      if (!listed('5.6', check, damage)) {
        return;
      }
      const logBefore = await logCount(damage.shortname);
      const body = admin.damaged.restoreBody({ shortname: damage.shortname, version: staleToken(damage.entry.version), save: damage.save });
      const res = await post(admin.damaged.restoreFiles, body);
      check('5.6', res.status === 409, `409 expected, got ${what(res)}`);
      await nothingStored(check, damage.shortname, damage.before, logBefore);
    }));

    it('fix-current with a token that is not the current one: 409, nothing stored; with the listed token: 200, the newest version the only current one (5.6)', runCase('admin', async (check) => {
      const shortname = t.track(t.name('stalefix'));
      await storeVersions(t, versionDocuments(t, shortname, [[0, 1], [0, 1, 2]]), false);
      const before = await adapter.versions(shortname);
      const { entry, res: listRes } = await listedEntry(t, shortname);
      check('5.6', Boolean(entry), `the project with two current versions is not in the damaged list: GET ${admin.damaged.list} ${what(listRes)}`);
      if (!entry) {
        return;
      }
      const logBefore = await logCount(shortname);
      const stale = await post(admin.damaged.fixCurrent, admin.damaged.fixBody({ shortname, version: staleToken(entry.version) }));
      check('5.6', stale.status === 409, `409 expected, got ${what(stale)}`);
      await nothingStored(check, shortname, before, logBefore);
      const res = await post(admin.damaged.fixCurrent, admin.damaged.fixBody({ shortname, version: entry.version }));
      check('5.6', res.status === 200, `the listed token: 200 expected, got ${what(res)}`);
      const currents = (await adapter.versions(shortname)).filter((v) => !v.backup);
      check('5.6', currents.length === 1 && id(currents[0]) === id(before[before.length - 1]), `the newest version, the only current one, expected; current: ${currents.map(id).join(', ')}`);
    }));
  });

  describe('5.7 a restore-files with the listed token: the missing rows back, with their names, as a new current version', function () {
    it('restore-files with the listed token: 200; one current version, a new one, the current rows then the missing one, with its name; every earlier version kept, as a backup (5.7)', runCase('admin', async (check) => {
      const damage = await lostAFile('restored');
      if (!listed('5.7', check, damage)) {
        return;
      }
      const { shortname, before } = damage;
      const res = await post(admin.damaged.restoreFiles, admin.damaged.restoreBody({ shortname, version: damage.entry.version, save: damage.save }));
      check('5.7', res.status === 200, `200 expected, got ${what(res)}`);
      const after = await adapter.versions(shortname);
      const currents = after.filter((v) => !v.backup);
      check('5.7', currents.length === 1, `one current version expected, got ${currents.length}`);
      check('5.7', currents.length > 0 && currents.every((v) => !before.some((b) => id(b) === id(v))), 'the current version is not a new one');
      keptAsBackups(check, before, after);
      const [first, last] = [before[0], before[before.length - 1]];
      const expected = [...adapter.fileList(last), adapter.fileList(first)[2]];
      const got = currents.length === 1 ? adapter.fileList(currents[0]) : [];
      check('5.7', JSON.stringify(got) === JSON.stringify(expected), `files ${JSON.stringify(expected)} expected, got ${JSON.stringify(got)}`);
    }));
  });
};

module.exports = { damagedCases, staleToken };
