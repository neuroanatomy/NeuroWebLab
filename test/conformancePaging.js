/**
 * The reference app's paging (test/conformanceApp.js), following slice 3's
 * rules: the project listing filtered, then paged (3.2), its `page`
 * parameter (3.15), and the slice of the files route (3.11-3.13). Each
 * `broken` option turns one rule off, so the suite's own test can show the
 * suite catches it.
 */
const { AccessControlService: ACS } = require('../index');

const PER_PAGE = 20;

/* A query value as a count (3.12, 3.15): a non-number or a negative value is 0 */
const count = (value) => Math.max(0, parseInt(value, 10) || 0);

/**
 * The files route's answer (3.11-3.13): from `start`, at most `length`, cut to
 * the list; `names=true` gives {source, name}
 * @param {Array<object>} list The stored files, {source, name}
 * @param {object} query The request's query
 * @param {object} broken The rules turned off: `noClamp` (Number(), unclamped), `filesOneBased` (start counted
 *        from 1), `namesAsStrings` (names=true gives the sources); with `filesRangeOptional` (3.14), a missing
 *        start or length is the whole list
 * @returns {Array} The answer
 */
const filesSlice = (list, query, broken) => {
  const { start = 0, length = list.length } = query;
  let from = broken.noClamp ? Number(start) : count(start);
  if (broken.filesOneBased) {
    from = Math.max(0, from - 1);
  }
  const slice = list.slice(from, from + (broken.noClamp ? Number(length) : count(length)));
  if (query.names !== 'true') {
    return slice;
  }

  return slice.map((f) => (broken.namesAsStrings ? f.source : { source: f.source, name: f.name }));
};

/**
 * GET /project/json?page: filtered, then paged (3.2), `pageBeforeFilter`:
 * paged, then filtered. No page: 200 {error}; a non-numeric or negative page
 * is 0 (3.15); `noPageError`: no page is page 0, `pageNaN`: Number(page)
 * @param {object} store The projects (conformanceApp.js makeStore)
 * @param {object} broken The rules turned off
 * @param {function(object): string} who The visitor of a request
 * @returns {function} The handler
 */
const listHandler = (store, broken, who) => (req, res) => {
  if (!req.query.page && !broken.noPageError) {
    return res.json({ error: 'Provide the parameter \'page\'' });
  }
  const n = broken.pageNaN ? Number(req.query.page) : count(req.query.page);
  const onPage = (list) => list.slice(n * PER_PAGE, (n + 1) * PER_PAGE);
  const visible = (list) => list.filter((p) => ACS.canViewFiles(p, who(req)));
  const listed = broken.pageBeforeFilter ? visible(onPage(store.listed())) : onPage(visible(store.listed()));
  res.json(listed.map((p) => ({ project: p.shortname, projectName: p.name, owner: p.owner })));
};

module.exports = { filesSlice, listHandler };
