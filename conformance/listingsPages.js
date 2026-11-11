/**
 * Slice 3 cases: `GET /project/json?page`. Only projects the visitor may
 * view are listed (3.1); filtered first, then paged: 20 per page, every page
 * full but the last, no project twice (3.2).
 */

const PER_PAGE = 20;
const MAX_PAGES = 100;

// eslint-disable-next-line max-lines-per-function
module.exports = (t) => {
  const { describe, it, runCase, R, plan } = t;
  const VISITORS = [
    { key: null, via: 'none', role: 'anonymous', sees: (p) => p.anyone.files === 'view' },
    { key: 'member', via: 'session', role: 'member', sees: (p) => p.anyone.files === 'view' || Boolean(p.rows.member) || p.owner === 'member' },
    { key: 'member', via: 'token', role: 'member by token', sees: (p) => p.anyone.files === 'view' || Boolean(p.rows.member) || p.owner === 'member' }
  ];

  /* Every page, until an empty one */
  const allPages = async (visitor) => {
    const pages = [];
    for (let n = 0; n < MAX_PAGES; n += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { res, body } = await t.get(visitor, t.fill('list', { page: n }));
      const rows = t.adapter.rows.list(body);
      if (!rows) {
        return { pages, error: `page ${n}: a list expected, got ${t.what(res)}` };
      }
      if (rows.length === 0) {
        return { pages };
      }
      pages.push(t.names(rows));
    }

    return { pages, error: `no empty page after ${MAX_PAGES}` };
  };

  const split = (visitor) => {
    const visible = plan.filter(visitor.sees).map((p) => t.name(p.key));
    const hidden = plan.filter((p) => !visitor.sees(p)).map((p) => t.name(p.key));

    return { visible, hidden };
  };

  describe(`GET ${R.list}: filtered, then paged`, function () {
    for (const visitor of VISITORS) {
      it(`${visitor.role}: lists no project it may not view (3.1)`, runCase('list', async (check) => {
        const { pages, error } = await allPages(visitor);
        check('3.1', !error, error);
        const listed = new Set(pages.flat());
        const shown = split(visitor).hidden.filter((s) => listed.has(s));
        check('3.1', shown.length === 0, `listed though hidden: ${shown.join(', ')}`);
      }));

      it(`${visitor.role}: ${PER_PAGE} per page, every page full but the last, each project it may view once (3.2)`, runCase('list', async (check) => {
        const { pages, error } = await allPages(visitor);
        check('3.2', !error, error);
        const short = pages.slice(0, -1).map((p, n) => [n, p.length])
          .filter(([, length]) => length !== PER_PAGE);
        check('3.2', short.length === 0, `pages not of ${PER_PAGE} before the last: ${JSON.stringify(short)}`);
        const last = pages.length ? pages[pages.length - 1].length : 0;
        check('3.2', last <= PER_PAGE, `last page of ${last}`);
        const all = pages.flat();
        const twice = all.filter((s, i) => all.indexOf(s) !== i);
        check('3.2', twice.length === 0, `listed twice: ${twice.join(', ')}`);
        const missing = split(visitor).visible.filter((s) => !all.includes(s));
        check('3.2', missing.length === 0, `${missing.length} projects it may view are not listed (${pages.map((p) => p.length).join('+')} listed): ${missing.slice(0, 5).join(', ')}`);
      }));
    }
  });
};
