/**
 * What the reference app (test/conformanceApp.js) puts around NeuroWebLab's
 * project route factories (1.21.0, routes/projectAccess.js; 1.22.0,
 * routes/userProjects.js): its store as the Db they read, and the `broken`
 * variants they cannot answer themselves.
 */

const NO_VIEW = 'Not authorized to view project';

/**
 * The variants of the routes NWL's factories answer (page, settings, JSON),
 * applied around them: `noView401`/`noView403` rewrite the code of a refusal
 * (the factories answer NWL's `noViewStatus(req)`); `authorizationRequired`
 * its text, BrainBox's before 1.17; `expiredTokenAccepted` takes an expired
 * token's user as logged in (1.19)
 * @param {object} broken The rules turned off
 * @returns {function} An express middleware
 */
const refusalVariants = (broken) => (req, res, next) => {
  const code = (broken.noView401 && 401) || (broken.noView403 && 403);
  if (code) {
    const status = res.status.bind(res);
    res.status = (s) => status([401, 403].includes(s) ? code : s);
  }
  if (broken.authorizationRequired) {
    const [send, json] = [res.send.bind(res), res.json.bind(res)];
    res.send = (body) => send(body === NO_VIEW ? 'Authorization required' : body);
    res.json = (body) => json(body && body.error === NO_VIEW ? { error: 'Authorization required' } : body);
  }
  if (broken.expiredTokenAccepted && req.isTokenAuthenticated === false) {
    req.user = { username: req.tokenUsername };
  }
  next();
};

/**
 * The value of a dotted path, through arrays as MongoDB does: every value
 * reached (`collaborators.list.username` gives each row's)
 * @param {*} value A document
 * @param {Array<string>} keys The path's keys
 * @returns {Array} The values reached
 */
const valuesAt = (value, keys) => {
  if (Array.isArray(value)) {
    return value.flatMap((v) => valuesAt(v, keys));
  }
  if (keys.length === 0) {
    return [value];
  }
  if (value === null || typeof value !== 'object' || !Object.hasOwn(value, keys[0])) {
    return [];
  }

  return valuesAt(value[keys[0]], keys.slice(1));
};

/**
 * Whether a document matches a filter of the kind the factories make:
 * `$or` and equality on dotted paths; a key of `ignored`
 * never matches (a store that does not look there)
 * @param {object} doc A document
 * @param {object} filter The filter
 * @param {Array<string>} ignored Keys that never match
 * @returns {boolean} Whether it matches
 */
const matches = (doc, filter, ignored) => Object.entries(filter).every(([key, cond]) => {
  if (key === '$or') {
    return cond.some((branch) => matches(doc, branch, ignored));
  }
  if (ignored.includes(key)) {
    return false;
  }

  return valuesAt(doc, key.split('.')).includes(cond);
});

/**
 * A `start` or `length` read as the store's own paging would (sliceBeforeFilter)
 * @param {*} value The query value
 * @param {number} fallback When it is not a string of digits
 * @returns {number} The number
 */
const countOf = (value, fallback) => (typeof value === 'string' && (/^\d+$/).test(value) ? Number(value) : fallback);

/**
 * The store as the native Db the factories read (findCurrentProject's
 * findOne, userProjectsRoute's find)
 * @param {object} store The store
 * @param {object} [options] `failUnknown`: the read of an unknown project
 *   rejects; `ignored`: filter keys the find never matches (`userIDOnly`,
 *   `noNickname`); `range`: a query whose `start`/`length` the find pages
 *   with, before the factory filters (`sliceBeforeFilter`)
 * @returns {object} A Db stub
 */
const storeDb = (store, { failUnknown = false, ignored = [], range = null } = {}) => ({
  collection: () => ({
    findOne: ({ shortname }) => {
      const p = store.current(shortname);

      return (!p && failUnknown) ? Promise.reject(new Error(`cannot read ${shortname}`)) : Promise.resolve(p || null);
    },
    find: (filter) => ({
      toArray: () => {
        // the store says which versions are current (`listBackups`, `noBackupMark`: slice 2's variants), as before 1.22.0
        const { backup, ...rest } = filter; // eslint-disable-line no-unused-vars
        const found = store.listed().filter((d) => matches(d, rest, ignored));
        if (!range) {
          return Promise.resolve(found);
        }
        const from = countOf(range.start, 0);

        return Promise.resolve(found.slice(from, from + countOf(range.length, Infinity)));
      }
    })
  })
});

module.exports = { refusalVariants, storeDb };
