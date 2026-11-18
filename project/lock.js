/**
 * The project lock (NeuroWebLab 1.18.0, stage 4 merge M11): it serialises the
 * changes to a project (saving its settings, deleting it, the admin tools that
 * change it), so that two of them cannot both read the current version and
 * then both write it. microdraw's `app/controller/projectLock.js` is the
 * reference (one FIFO queue per key); here a holder may take several keys.
 *
 * The state is one `Map` in this module, so it is shared by everything that
 * requires the same copy of `neuroweblab`. There must be a single copy per
 * app (`npm ls neuroweblab` shows one, in microdraw and BrainBox): a second
 * copy would have its own map, and its holders would not exclude the others.
 * It only covers one process: two processes (or two servers) on the same
 * database are not serialised.
 *
 * There is no timeout and no limit on the number of waiting holders: a holder
 * waits until every earlier holder of its keys has finished.
 */

// key -> the promise that resolves when the last holder (or waiter) of the key
// has finished; the entry is deleted when the last holder leaves
const tails = new Map();

/**
 * The keys, checked, without duplicates and sorted
 * @param {string|string[]} keys A key, or a non-empty array of keys
 * @returns {string[]} The keys, in the order they are taken
 */
const keyList = (keys) => {
  const list = Array.isArray(keys) ? keys : [keys];
  if (list.length === 0) {
    throw new TypeError('withLock: the array of keys is empty');
  }
  for (const key of list) {
    if (typeof key !== 'string') {
      throw new TypeError(`withLock: a key must be a string, got ${key === null ? 'null' : typeof key}`);
    }
    if (key === '') {
      throw new TypeError('withLock: a key must not be an empty string');
    }
  }

  return [...new Set(list)].sort();
};

/**
 * Wait in the queue of one key
 * @param {string} key The key
 * @returns {Promise<function>} Resolves, once every earlier holder of the key
 *   has finished, with the function that releases it
 */
const take = async (key) => {
  const previous = tails.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  tails.set(key, tail);
  await previous;

  return () => {
    release();
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  };
};

/**
 * Run `fn` once every earlier holder of each of `keys` has finished (FIFO per
 * key).
 *
 * With several keys, the duplicates are dropped and the keys are sorted, then
 * taken one after the other, each waiting in its own queue. Every caller takes
 * its keys in the same order, so two callers asking for `['a', 'b']` and
 * `['b', 'a']` can never deadlock. A holder of `['project', 'mri']` excludes a
 * holder of `'mri'` alone, and the other way round. The keys are released in
 * the reverse order.
 * @param {string|string[]} keys A key, or a non-empty array of keys (non-empty
 *   strings)
 * @param {function} fn The work, sync or async, called with no argument
 * @returns {Promise<*>} What `fn` returns. Rejects with what `fn` throws,
 *   which also releases every key; rejects with a `TypeError`, without calling
 *   `fn`, if a key is not a non-empty string or the array is empty
 */
const withLock = async (keys, fn) => {
  const list = keyList(keys);
  const releases = [];
  try {
    for (const key of list) {
      // eslint-disable-next-line no-await-in-loop
      releases.push(await take(key));
    }

    return await fn();
  } finally {
    for (const release of releases.reverse()) {
      release();
    }
  }
};

/**
 * Whether someone holds or waits for a key (mainly for tests)
 * @param {string} key The key
 * @returns {boolean} True if the key is held or waited for
 */
const isLocked = (key) => tails.has(key);

/**
 * The key of a project's lock (microdraw's)
 * @param {string} shortname The project's shortname
 * @returns {string} `project:<shortname>`
 */
const projectKey = (shortname) => `project:${shortname}`;

/**
 * Run `fn` holding the lock of a project: `withLock(projectKey(shortname), fn)`
 * @param {string} shortname The project's shortname
 * @param {function} fn The work, sync or async
 * @returns {Promise<*>} What `fn` returns
 */
const withProjectLock = (shortname, fn) => withLock(projectKey(shortname), fn);

module.exports = { withLock, isLocked, projectKey, withProjectLock };
