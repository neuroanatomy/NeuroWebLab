/**
 * What the helpers need to keep monk's behaviours on the native driver
 * (0.2.0 ran on monk; callers rely on these):
 * - a MongoDB URI with or without the `mongodb://` scheme,
 * - string `_id`s cast to ObjectId in queries, updates and inserted documents,
 * - the `fields` find option (array, space-separated string or object) as
 *   `projection`, and array/string `sort`,
 * - the write results monk returned.
 * Only APIs present in both mongodb 6.x and 7.x are used.
 */
const { ObjectId } = require('mongodb');

/**
 * @param {string} uri A MongoDB URI, e.g. `localhost:27017/brainbox` or `mongodb://localhost:27017/brainbox`
 * @returns {string} The URI with a scheme (`mongodb://` added when it has none)
 */
const toMongoUri = (uri) => {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new Error('MONGO_DB must be a non-empty string');
  }

  return (/^mongodb(\+srv)?:\/\//).test(uri) ? uri : `mongodb://${uri}`;
};

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
};

/**
 * @param {*} value An id
 * @returns {*} An ObjectId if value is a 24-character hex string, value otherwise
 */
const toId = (value) => ((typeof value === 'string' && value.length === 24 && ObjectId.isValid(value))
  ? new ObjectId(value)
  : value);

/**
 * Cast string `_id`s to ObjectId, in place and at any depth, as monk did
 * (`_id: str`, `_id: {$in: [...]}`, `{$nin: [...]}`, `{$ne: str}`).
 * Strings that are not 24-character hex ids are left as they are (monk threw).
 * @param {*} obj A query, an update or a document (or an array of them)
 * @returns {*} obj
 */
const castIds = (obj) => {
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => { obj[i] = castIds(item); });

    return obj;
  }
  if (!isPlainObject(obj)) {
    return obj;
  }
  for (const k of Object.keys(obj)) {
    if (k === '_id' && obj._id) {
      const id = obj._id;
      if (isPlainObject(id) && Array.isArray(id.$in)) {
        id.$in = id.$in.map(toId);
      } else if (isPlainObject(id) && Array.isArray(id.$nin)) {
        id.$nin = id.$nin.map(toId);
      } else if (isPlainObject(id) && '$ne' in id) {
        id.$ne = toId(id.$ne);
      } else {
        obj._id = toId(id);
      }
    } else {
      obj[k] = castIds(obj[k]);
    }
  }

  return obj;
};

/**
 * monk's field lists: ['a', 'b'] or 'a b' → {a: 1, b: 1}; '-a' → {a: minus}
 * @param {*} spec An array, a space-separated string or an object
 * @param {number} minus The value for a '-name' entry
 * @returns {object} A field object
 */
const fieldObject = (spec, minus) => {
  if (isPlainObject(spec)) {
    return spec;
  }
  const list = typeof spec === 'string' ? spec.split(' ') : spec;
  const result = {};
  for (const name of list) {
    if (name.startsWith('-')) {
      result[name.slice(1)] = minus;
    } else if (name) {
      result[name] = 1;
    }
  }

  return result;
};

/**
 * Find options as monk took them, for the native driver.
 * @param {object|Array|string} options {skip, limit, sort, fields, projection, ...},
 *   or a field list (as monk accepted)
 * @returns {object} Native find options (`fields` → `projection`)
 */
const findOptions = (options = {}) => {
  if (typeof options === 'string' || Array.isArray(options)) {
    return { projection: fieldObject(options, 0) };
  }
  const { fields, ...rest } = options || {};
  if (fields) {
    rest.projection = fieldObject(fields, 0);
  }
  if (rest.sort && (typeof rest.sort === 'string' || Array.isArray(rest.sort))) {
    rest.sort = fieldObject(rest.sort, -1);
  }

  return rest;
};

/**
 * The result monk's update() returned with the 3.7 driver: {n, nModified, ok}
 * (and `upserted` after an upsert).
 * @param {object} result A native UpdateResult
 * @returns {object} {n, nModified, ok[, upserted]}
 */
const updateResult = (result) => {
  const legacy = {
    n: result.matchedCount + result.upsertedCount,
    nModified: result.modifiedCount,
    ok: result.acknowledged ? 1 : 0
  };
  if (result.upsertedId !== null && typeof result.upsertedId !== 'undefined') {
    legacy.upserted = [{ index: 0, _id: result.upsertedId }];
  }

  return legacy;
};

/**
 * monk's update(query, update, {multi, single, replace, ...}) on the native driver.
 * @param {object} collection A native collection
 * @param {object} query The selection
 * @param {object} updateDoc The update
 * @param {object} options {multi, upsert, ...}
 * @returns {Promise<object>} {n, nModified, ok}
 */
const update = async (collection, query, updateDoc, options = {}) => {
  const { multi, single, replace, replaceOne, ...rest } = options || {};
  const many = multi || single === false;
  let method = many ? 'updateMany' : 'updateOne';
  if (replace || replaceOne) {
    if (many) {
      throw new Error('The `replace` option is only available for single updates.');
    }
    method = 'replaceOne';
  }

  return updateResult(await collection[method](castIds(query), castIds(updateDoc), rest));
};

/**
 * monk's insert(doc or array): the documents, with their `_id`.
 * @param {object} collection A native collection
 * @param {object|Array} data A document or an array of documents
 * @returns {Promise<object|Array>} The inserted document(s)
 */
const insert = async (collection, data) => {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return [];
    }
    await collection.insertMany(castIds(data));

    return data;
  }
  await collection.insertOne(castIds(data));

  return data;
};

/**
 * monk's remove(query): deleteMany (deleteOne with {single: true} or {multi: false}).
 * @param {object} collection A native collection
 * @param {object} query The selection
 * @param {object} options {single, multi}
 * @returns {Promise<object>} {deletedCount, result: {n, ok}}
 */
const remove = async (collection, query, options = {}) => {
  const { single, multi, ...rest } = options || {};
  const method = single || multi === false ? 'deleteOne' : 'deleteMany';
  const result = await collection[method](castIds(query), rest);

  return {
    deletedCount: result.deletedCount,
    result: { n: result.deletedCount, ok: result.acknowledged ? 1 : 0 }
  };
};

/**
 * monk's find(query, options): an array.
 * @param {object} collection A native collection
 * @param {object} query The selection
 * @param {object} options monk find options
 * @returns {Promise<Array>} The documents found
 */
const find = (collection, query = {}, options = {}) => collection
  .find(castIds(query), findOptions(options))
  .toArray();

/**
 * monk's findOne(query, options): a document or null.
 * @param {object} collection A native collection
 * @param {object} query The selection
 * @param {object} options monk find options
 * @returns {Promise<object|null>} The document found or null
 */
const findOne = (collection, query = {}, options = {}) => collection
  .findOne(castIds(query), findOptions(options));

module.exports = {
  ObjectId,
  toMongoUri,
  castIds,
  findOptions,
  updateResult,
  find,
  findOne,
  insert,
  update,
  remove
};
