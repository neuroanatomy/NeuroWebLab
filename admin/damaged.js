/* eslint-disable max-lines -- the analysis, its two fixes and their JSDoc, one module (microdraw's admin.damaged.js) */
/**
 * Damaged projects (NeuroWebLab 1.23.0, stage 4 merge M16, decision D6
 * option A): the analysis and the two fixes of both apps' admin tools.
 * microdraw's `app/controller/admin/admin.damaged.js` is the reference (the
 * version token, the removal events, rows kept with their names, the log
 * entry with the previous document and the `after` token); BrainBox's
 * `controller/admin/admin.projects.js` is the same analysis without a token.
 *
 * A project's versions are documents with the same shortname in the
 * configured `projectsCollection`; the current one has no `backup` field
 * (project/versions.js). A project is damaged when:
 * - files removed by a save are still missing from the current version. The
 *   settings page used to save before every batch of 100 files had arrived:
 *   a save that kept the first files of the previous version, a multiple of
 *   100 of them (maybe none), is flagged as an incomplete save. Other
 *   removals are listed too, as they may have been deliberate;
 * - it has several current versions (a race between two saves).
 *
 * What differs by app is given by an adapter: the file rows of a version
 * (`sourcesOf`; versions are compared by source), the sources that have
 * annotations (`annotatedFiles`), how a new version is stored (`save`, with
 * the app's side effects) and the lock's keys (`lockKeys`).
 *
 * The fixes hold the lock, refuse a project changed since the list was read
 * (projectVersion, 409), and are logged in `log` (adminLog):
 * - restore-files stores a new version with the missing rows added at the
 *   end of the list, each with the name it had before the save; the entry has
 *   the previous document (without `_id`) and the `after` token, so that an
 *   undo is possible;
 * - fix-current marks the older current versions `backup`; the entry lists
 *   their ids (unset `backup` on them to undo it).
 */
const _ = require('lodash');
const Configuration = require('../Configuration');
const { adminLog } = require('./actions');
const { CURRENT, findCurrentProject, projectVersion } = require('../project/versions');
const { withLock } = require('../project/lock');
const { toId } = require('../util/toId');

const BATCH_LENGTH = 100; // files per batch in the settings page
const EXAMPLES = 3; // missing files shown for each save

const staleError = (shortname) => `Project ${shortname} has changed since it was listed: reload the list`;

const projects = (db) => db.collection(Configuration.getInstance().projectsCollection);

const isProjectName = (name) => typeof name === 'string' && name !== '';

/**
 * When a version was stored: its `modified` (an ISO string, as both apps
 * store it), else the time of its `_id`, else null
 * @param {object} version A version
 * @returns {string|null} The date
 */
const dateOf = (version) => {
  if (typeof version.modified === 'string') {
    return version.modified;
  }
  try {
    return version._id.getTimestamp().toJSON();
  } catch (err) {
    return null;
  }
};

/**
 * Whether a save looks like it sent an incomplete list of files: it keeps the
 * first files of the previous version, a multiple of BATCH_LENGTH of them
 * @param {Array<string>} before Sources of the previous version
 * @param {Array<string>} after Sources of the version saved
 * @returns {boolean} True for an incomplete save
 */
const isIncompleteSave = (before, after) => after.length < before.length &&
  after.length % BATCH_LENGTH === 0 &&
  after.every((s, i) => s === before[i]);

/**
 * The sources of a version that the next one does not have, in order, each once
 * @param {Array<string>} before Sources of the version
 * @param {Array<string>} after Sources of the next version
 * @returns {Array<string>} The sources removed
 */
const removedFiles = (before, after) => {
  const kept = new Set(after);

  return [...new Set(before)].filter((s) => !kept.has(s));
};

/**
 * The sources of a version's rows (the adapter's `sourcesOf`), strings only
 * @param {function(object): Array<{source: string, name: string}>} sourcesOf The adapter's
 * @param {object} version A version
 * @returns {Array<string>} The sources, in order
 */
const sourceList = (sourcesOf, version) => sourcesOf(version).map((r) => r && r.source)
  .filter((s) => typeof s === 'string');

/**
 * The saves of a project that removed files still missing from its current
 * version (`now`)
 * @param {Array<object>} versions The versions, oldest first
 * @param {Set<string>} now The sources of the current version
 * @param {function(object): Array<object>} sourcesOf The adapter's
 * @returns {Array<object>} One event per save: { save, previous, modified,
 *   modifiedBy, before, after, removed, stillMissing (the sources), incomplete }
 */
const removalEvents = (versions, now, sourcesOf) => {
  const events = [];
  for (let i = 1; i < versions.length; i++) {
    const before = sourceList(sourcesOf, versions[i - 1]);
    const after = sourceList(sourcesOf, versions[i]);
    const removed = removedFiles(before, after);
    const stillMissing = removed.filter((s) => !now.has(s));
    if (stillMissing.length > 0) {
      events.push({
        save: String(versions[i]._id),
        previous: String(versions[i - 1]._id),
        modified: dateOf(versions[i]),
        modifiedBy: versions[i].modifiedBy || null,
        before: before.length,
        after: after.length,
        removed: removed.length,
        stillMissing,
        incomplete: isIncompleteSave(before, after)
      });
    }
  }

  return events;
};

/**
 * The versions of a project, oldest first, with what is needed to compare
 * their files
 * @param {object} db Native MongoDB Db
 * @param {string} shortname Project shortname
 * @returns {Promise<Array<object>>} The versions
 */
const projectVersions = (db, shortname) => projects(db)
  .find({ shortname }, { projection: { files: 1, modified: 1, modifiedBy: 1, backup: 1 }, sort: { _id: 1 } })
  .toArray();

const ADAPTER_FUNCTIONS = ['sourcesOf', 'annotatedFiles', 'save', 'lockKeys'];

/**
 * The damaged projects tools of an app
 * @param {object} adapter The app's
 * @param {function(object): Array<{source: string, name: string}>} adapter.sourcesOf The
 *   file rows of a version (old plain strings as rows); versions are compared by source
 * @param {function(object, string, Array<string>): Promise<Set<string>>} adapter.annotatedFiles
 *   (db, shortname, sources): those of the sources that have annotations in the project
 * @param {function(object, object, object): Promise<*>} adapter.save (db, doc, {by, previous}):
 *   store `doc` as the project's new version (the app's saveProjectVersion and its hooks)
 * @param {function(string): Array<string>} adapter.lockKeys The lock's keys for a project
 * @param {object} [adapter.logger] Logger of adminLog (info(object, message)); none, no line
 * @param {function(object): object} [adapter.logFields] The fields of adminLog's line
 * @returns {object} { findDamagedProjects(db), restoreFiles(db, params),
 *   fixCurrentVersions(db, params), isIncompleteSave }
 */
// eslint-disable-next-line max-lines-per-function
const damagedProjects = (adapter) => {
  if (adapter === null || typeof adapter !== 'object') {
    throw new TypeError('damagedProjects: an adapter object is needed');
  }
  for (const field of ADAPTER_FUNCTIONS) {
    if (typeof adapter[field] !== 'function') {
      throw new TypeError(`damagedProjects: adapter.${field} must be a function`);
    }
  }
  const { sourcesOf, annotatedFiles, save, lockKeys, logger, logFields } = adapter;
  const sources = (version) => sourceList(sourcesOf, version);
  const log = (db, key, value) => adminLog(db, key, value, { logger, ...(typeof logFields === 'function' ? { fields: logFields } : {}) });

  /**
   * Examine a project's versions. Read-only.
   * @param {object} db Native MongoDB Db
   * @param {string} shortname Project shortname
   * @returns {Promise<object|null>} The damage found, or null if there is none
   */
  // eslint-disable-next-line max-statements
  const examineProject = async (db, shortname) => {
    const versions = await projectVersions(db, shortname);
    const currents = versions.filter((v) => !v.backup);
    if (currents.length === 0) {
      return null; // a deleted project
    }
    const latest = currents[currents.length - 1];
    const events = removalEvents(versions, new Set(sources(latest)), sourcesOf);
    if (events.length === 0 && currents.length === 1) {
      return null;
    }
    const missing = [...new Set(events.flatMap((e) => e.stillMissing))];
    const annotated = missing.length > 0 ? await annotatedFiles(db, shortname, missing) : new Set();
    const project = await findCurrentProject(db, shortname);

    return {
      shortname,
      name: typeof project.name === 'string' ? project.name : '',
      owner: project.owner,
      version: projectVersion(project),
      files: sources(latest).length,
      versions: versions.length,
      currentVersions: currents.map((v) => ({ id: String(v._id), modified: dateOf(v), modifiedBy: v.modifiedBy || null })),
      missing: missing.length,
      suspected: events.some((e) => e.incomplete),
      events: events.map(({ stillMissing, ...e }) => ({
        ...e,
        stillMissing: stillMissing.length,
        annotated: stillMissing.filter((s) => annotated.has(s)).length,
        examples: stillMissing.slice(0, EXAMPLES)
      }))
    };
  };

  /**
   * Find the damaged projects, one at a time (bounded memory). Projects with
   * an incomplete save come first, then those with the most files missing,
   * then by shortname. Read-only.
   * @param {object} db Native MongoDB Db
   * @returns {Promise<object>} { list: [{ shortname, name, owner, version,
   *   files, versions, currentVersions: [{ id, modified, modifiedBy }],
   *   missing, suspected, events: [{ save, previous, modified, modifiedBy,
   *   before, after, removed, stillMissing, annotated, incomplete, examples }]
   *   }] }, where an event is a save (`save`, the _id of the version it
   *   stored) that removed files still missing
   */
  const findDamagedProjects = async (db) => {
    const shortnames = (await projects(db).distinct('shortname')).filter(isProjectName);
    const list = [];
    for (const shortname of shortnames) {
      // eslint-disable-next-line no-await-in-loop
      const damage = await examineProject(db, shortname);
      if (damage) {
        list.push(damage);
      }
    }
    list.sort((a, b) => (Number(b.suspected) - Number(a.suspected)) || (b.missing - a.missing) || a.shortname.localeCompare(b.shortname));

    return { list };
  };

  /**
   * The rows to add back for a save: those of the version before it whose
   * source the save removed and the current version does not have, one per
   * source, with the name they had
   * @param {Array<object>} versions The versions, oldest first
   * @param {object} id ObjectId of the version the save stored
   * @param {object} stored The current version
   * @returns {object} { rows } or { status, error }
   */
  const rowsToRestore = (versions, id, stored) => {
    const index = versions.findIndex((v) => id.equals(v._id));
    if (index < 1) {
      return { status: 404, error: 'No save of this project stored that version' };
    }
    const removed = new Set(removedFiles(sources(versions[index - 1]), sources(versions[index])));
    const now = new Set(sources(stored));
    const rows = _.uniqBy(sourcesOf(versions[index - 1]).filter((r) => r && removed.has(r.source) && !now.has(r.source)), 'source');
    if (rows.length === 0) {
      return { status: 409, error: 'The files that save removed are all in the project' };
    }

    return { rows: rows.map((r) => ({ source: r.source, name: typeof r.name === 'string' ? r.name : '' })) };
  };

  /**
   * Add back to a project the files that a save removed and that are still
   * missing, after its current files, as a new version. Refused while the
   * project has several current versions (fix-current first), and if it
   * changed since it was listed.
   * @param {object} db Native MongoDB Db
   * @param {object} params { shortname, version: the token of the list,
   *   save: the _id of the version the save stored, username }
   * @returns {Promise<object>} { restored, files, version, log } or { status, error }
   */
  // eslint-disable-next-line max-statements
  const restoreFiles = (db, { shortname, version, save: saveId, username }) => withLock(lockKeys(shortname), async () => {
    const id = toId(saveId);
    if (!id) {
      return { status: 400, error: 'Provide the save: the id of the version it stored, as listed' };
    }
    const versions = await projectVersions(db, shortname);
    const currents = versions.filter((v) => !v.backup);
    if (currents.length === 0) {
      return { status: 404, error: `Project ${shortname} not found` };
    }
    if (currents.length > 1) {
      return { status: 409, error: `Project ${shortname} has ${currents.length} current versions: fix that first` };
    }
    const stored = await findCurrentProject(db, shortname);
    if (projectVersion(stored) !== version) {
      return { status: 409, error: staleError(shortname) };
    }
    const plan = rowsToRestore(versions, id, stored);
    if (plan.error) {
      return plan;
    }
    const storedList = stored.files && Array.isArray(stored.files.list) ? stored.files.list : [];
    const files = { ...(_.isPlainObject(stored.files) ? stored.files : {}), list: [...storedList, ...plan.rows] };
    const entry = await log(db, 'adminRestoreProjectFiles', {
      username, shortname, before: version, save: saveId, files: plan.rows.map((r) => r.source), project: _.omit(stored, ['_id'])
    });
    await save(db, { ...stored, files }, { by: username, previous: stored });
    const after = projectVersion(await findCurrentProject(db, shortname));
    await db.collection('log').updateOne({ _id: entry._id }, { $set: { 'value.after': after } });

    return { restored: plan.rows.length, files: files.list.length, version: after, log: String(entry._id) };
  });

  /**
   * Keep the newest of several current versions of a project, and mark the
   * others `backup`
   * @param {object} db Native MongoDB Db
   * @param {object} params { shortname, version: the token of the list (of
   *   the newest current version), username }
   * @returns {Promise<object>} { kept, backups, version, log } or { status, error }
   */
  const fixCurrentVersions = (db, { shortname, version, username }) => withLock(lockKeys(shortname), async () => {
    const currents = await projects(db)
      .find({ shortname, ...CURRENT }, { sort: { _id: 1 } })
      .toArray();
    if (currents.length === 0) {
      return { status: 404, error: `Project ${shortname} not found` };
    }
    const kept = currents.pop();
    if (projectVersion(kept) !== version) {
      return { status: 409, error: staleError(shortname) };
    }
    if (currents.length === 0) {
      return { status: 409, error: `Project ${shortname} does not have several current versions` };
    }
    const backups = currents.map((v) => v._id);
    await projects(db).updateMany({ _id: { $in: backups }, ...CURRENT }, { $set: { backup: true } });
    const entry = await log(db, 'adminFixCurrentVersions', {
      username, shortname, kept: String(kept._id), backups: backups.map(String)
    });

    return { kept: String(kept._id), backups: backups.length, version, log: String(entry._id) };
  });

  return { findDamagedProjects, restoreFiles, fixCurrentVersions, isIncompleteSave };
};

module.exports = {
  BATCH_LENGTH,
  EXAMPLES,
  damagedProjects,
  dateOf,
  isIncompleteSave,
  removedFiles,
  removalEvents
};
