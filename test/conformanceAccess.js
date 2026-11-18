/**
 * What the reference app (test/conformanceApp.js) puts around NeuroWebLab's
 * project route factories (1.21.0, routes/projectAccess.js): its store as
 * the Db they read, and the `broken` variants they cannot answer themselves.
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
 * The store as the native Db the factories read (findCurrentProject's findOne)
 * @param {object} store The store
 * @param {object} [options] `failUnknown`: the read of an unknown project rejects
 * @returns {object} A Db stub
 */
const storeDb = (store, { failUnknown = false } = {}) => ({
  collection: () => ({
    findOne: ({ shortname }) => {
      const p = store.current(shortname);

      return (!p && failUnknown) ? Promise.reject(new Error(`cannot read ${shortname}`)) : Promise.resolve(p || null);
    }
  })
});

module.exports = { refusalVariants, storeDb };
