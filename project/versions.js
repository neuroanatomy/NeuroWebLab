/**
 * Project versions (NeuroWebLab 1.16.0, stage 4 merge M9). microdraw's
 * `app/controller/project/currentProject.js` is the reference.
 *
 * A project's old versions are kept as documents with the same shortname and
 * `backup: true`; the current one has no `backup` field. There should be one
 * current document per shortname. If there are several (a failure between
 * the two writes of a save), the newest `_id` wins, so that every read gives
 * the same answer.
 *
 * The collection is the configured `projectsCollection`
 * (`Configuration.getInstance().projectsCollection`), read on each call:
 * microdraw's is `projects`, BrainBox's `project`. The queries need an index
 * on `{shortname: 1}`, which each app creates.
 */

const crypto = require('crypto');
const _ = require('lodash');
const Configuration = require('../Configuration');

// The query of the current version(s): no `backup` field
const CURRENT = { backup: { $exists: false } };

// Find options: of several current documents, the newest `_id` first
const NEWEST_FIRST = { sort: { _id: -1 } };

const projects = (db) => db.collection(Configuration.getInstance().projectsCollection);

/**
 * Read the current version of a project. Needs the `{shortname: 1}` index.
 * @param {object} db Native MongoDB Db
 * @param {string} shortname The project's shortname
 * @param {object} [options] { projection: a MongoDB projection (left out
 *   when not given: the whole document) }
 * @returns {Promise<object|null>} The project (of several current versions,
 *   the newest `_id`), or null if there is none or the shortname is not a
 *   string (no query is made)
 */
const findCurrentProject = (db, shortname, { projection } = {}) => {
  if (typeof shortname !== 'string') {
    return Promise.resolve(null);
  }
  const options = typeof projection === 'object' && projection !== null ? { ...NEWEST_FIRST, projection } : NEWEST_FIRST;

  return projects(db).findOne({ shortname, ...CURRENT }, options);
};

/**
 * Store a new version of a project: insert it as a new document, then mark
 * every other current document of its shortname `backup: true`. Insert
 * first: a failure between the two writes leaves two current versions (reads
 * take the newest, findCurrentProject; the next save leaves one), never none.
 * The caller holds the project's lock. Needs the `{shortname: 1}` index.
 *
 * A change that is not a user's edit (a migration of the stored projects)
 * passes `keepModified`: the version keeps the `modified` and `modifiedBy` of
 * `doc` (or keeps them absent), so that "Last modified" does not change.
 *
 * `afterSave`, if given, is awaited after both writes with
 * `{db, previous, version}`: `previous` is the current version before the
 * save (the whole document, read before the insert; null for a new project),
 * `version` the document stored. Its rejection reaches the caller, but the
 * version is saved already: a hook that must not fail the save catches its
 * own errors. Without `afterSave`, the previous version is not read.
 * @param {object} db Native MongoDB Db
 * @param {object} doc The project; an `_id` or `backup` in it is ignored, and
 *   `doc` itself is not changed
 * @param {object} [options] { by: the username stored as `modifiedBy`;
 *   keepModified: true to keep `doc`'s `modified` and `modifiedBy` instead;
 *   afterSave: async ({db, previous, version}) => void }
 * @returns {Promise<object>} The document as stored, with its new `_id`
 */
const saveProjectVersion = async (db, doc, { by, keepModified = false, afterSave } = {}) => {
  // `modified` is an ISO string, as both apps store it
  const version = keepModified ?
    _.omit(doc, ['_id', 'backup']) :
    { ..._.omit(doc, ['_id', 'backup']), modified: (new Date()).toJSON(), modifiedBy: by };
  const collection = projects(db);
  const previous = afterSave ?
    await collection.findOne({ shortname: version.shortname, ...CURRENT }, NEWEST_FIRST) :
    null;
  await collection.insertOne(version); // sets version._id
  await collection.updateMany(
    { shortname: version.shortname, ...CURRENT, _id: { $ne: version._id } },
    { $set: { backup: true } }
  );
  if (afterSave) {
    await afterSave({ db, previous, version });
  }

  return version;
};

/**
 * A token for a stored version of a project (NeuroWebLab 1.23.0, stage 4
 * merge M16; microdraw's `project.check.js` projectVersion, unchanged: its
 * admin page holds tokens computed by it). The admin fixes refuse a project
 * whose token changed since it was listed (decision D6).
 *
 * It is a hash of `JSON.stringify(doc)`, so it depends on the order of the
 * document's keys. A document read from MongoDB has its keys in the order
 * stored (BSON keeps it, the driver builds the object in that order), so two
 * reads of the same stored document give the same token, and any write to it
 * (a new version, a `$set`) changes the document or its `_id`. The token must
 * be computed on the whole document as `findCurrentProject` reads it: a
 * projection, or a copy whose keys were added in another order, gives
 * another token.
 * @param {object} doc The project document, as read from the database
 * @returns {string} The first 20 hexadecimal digits of its sha256
 */
const projectVersion = (doc) => crypto.createHash('sha256').update(JSON.stringify(doc))
  .digest('hex')
  .slice(0, 20);

module.exports = { CURRENT, NEWEST_FIRST, findCurrentProject, saveProjectVersion, projectVersion };
