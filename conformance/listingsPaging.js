/**
 * Slice 3 cases (NeuroWebLab 1.17.0): paging the files of a project and the
 * `?page` parameter of the listing. On a public project of 5 files, as the
 * anonymous visitor:
 * - 3.11 `GET /project/json/:p/files?start&length`: the slice, in list order,
 *   cut to the list (a `start` past its end gives []);
 * - 3.12 a negative or non-numeric `start` or `length` counts as 0;
 * - 3.13 `names=true` gives `{source, name}` rows only, `name` a string;
 * - 3.14 without `start` or without `length`: 200 with an `error` key;
 * - 3.15 `GET /project/json?page`: a non-numeric or negative `page` is page
 *   0; no `page` gives 200 with an `error` key.
 * The files route is `routes.filesPaged` (the query is the suite's).
 */

const ANONYMOUS = { key: null, via: 'none' };

/* A file of the answer: its source (BrainBox answers objects from `mri`, microdraw the stored rows) */
const sourceOf = (f) => (typeof f === 'string' ? f : f && f.source);

// eslint-disable-next-line max-lines-per-function
module.exports = (t) => {
  const { describe, it, runCase, R } = t;
  const sources = () => Array.from({ length: 5 }, (_, i) => `https://example.org/conformance/${t.name('paged')}/file${i}.nii.gz`);

  /* GET the files route with a raw query, e.g. 'start=1&length=2' */
  const files = (query) => {
    const path = t.fill('filesPaged', { p: t.name('paged') });

    return t.get(ANONYMOUS, `${path}${path.includes('?') ? '&' : '?'}${query}`);
  };

  /* The sources answered for a query, or a text saying what came instead */
  const slice = async (check, rule, query) => {
    const { res, body } = await files(query);
    const ok = res.status === 200 && Array.isArray(body);
    check(rule, ok, `${query}: 200 and a list expected, got ${t.what(res)}`);

    return ok ? body.map(sourceOf) : null;
  };

  const same = (check, rule, query, got, expected) => {
    check(rule, JSON.stringify(got) === JSON.stringify(expected), `${query}: ${JSON.stringify(expected.map((s) => s.slice(s.lastIndexOf('/') + 1)))} expected, got ${JSON.stringify(got)}`);
  };

  describe(`GET ${R.filesPaged}?start&length: paging (3.11-3.14)`, function () {
    it('anonymous: start=1&length=2 gives the 2nd and 3rd files, in list order (3.11)', runCase('filesPaged', async (check) => {
      const query = 'start=1&length=2';
      same(check, '3.11', query, await slice(check, '3.11', query), sources().slice(1, 3));
    }));

    it('anonymous: cut to the list, a start past the end gives [] (3.11)', runCase('filesPaged', async (check) => {
      for (const [query, expected] of [['start=5&length=2', []], ['start=50&length=2', []], ['start=3&length=50', sources().slice(3)]]) {
        // eslint-disable-next-line no-await-in-loop
        same(check, '3.11', query, await slice(check, '3.11', query), expected);
      }
    }));

    it('anonymous: a negative or non-numeric start or length counts as 0 (3.12)', runCase('filesPaged', async (check) => {
      const CASES = [
        ['start=-1&length=2', sources().slice(0, 2)],
        ['start=abc&length=2', sources().slice(0, 2)],
        ['start=1&length=-1', []],
        ['start=1&length=abc', []]
      ];
      for (const [query, expected] of CASES) {
        // eslint-disable-next-line no-await-in-loop
        same(check, '3.12', query, await slice(check, '3.12', query), expected);
      }
    }));

    it('anonymous: names=true gives {source, name} rows only, name a string (3.13)', runCase('filesPaged', async (check) => {
      const query = 'start=0&length=5&names=true';
      const { res, body } = await files(query);
      check('3.13', res.status === 200 && Array.isArray(body), `200 and a list expected, got ${t.what(res)}`);
      if (Array.isArray(body)) {
        same(check, '3.13', query, body.map(sourceOf), sources());
        const odd = body.filter((r) => !r || typeof r !== 'object' || Object.keys(r).sort()
          .join() !== 'name,source' || typeof r.name !== 'string');
        check('3.13', odd.length === 0, `rows other than {source, name: string}: ${JSON.stringify(odd.slice(0, 2))}`);
      }
    }));

    for (const query of ['length=2', 'start=0']) {
      it(`anonymous: ${query} only: 200 with an error key (3.14)`, runCase('filesPaged', async (check) => {
        const { res, body } = await files(query);
        check('3.14', res.status === 200 && body !== null && typeof body === 'object' && 'error' in body, `200 {error} expected, got ${t.what(res)}`);
      }));
    }
  });

  describe(`GET ${R.list}: the page parameter (3.15)`, function () {
    const listed = async (path) => {
      const { res, body } = await t.get(ANONYMOUS, path);

      return { res, body, rows: t.adapter.rows.list(body) };
    };

    it('anonymous: a non-numeric or negative page is page 0 (3.15)', runCase('list', async (check) => {
      const first = await listed(t.fill('list', { page: 0 }));
      check('3.15', Array.isArray(first.rows) && first.rows.length > 0, `page 0: a list expected, got ${t.what(first.res)}`);
      for (const page of ['abc', '-1']) {
        // eslint-disable-next-line no-await-in-loop
        const other = await listed(t.fill('list', { page }));
        const [a, b] = [t.names(first.rows), t.names(other.rows)];
        check('3.15', Array.isArray(other.rows) && JSON.stringify(a) === JSON.stringify(b), `page=${page}: page 0 expected (${a.length} projects), got ${t.what(other.res)}`);
      }
    }));

    it('anonymous: no page gives 200 with an error key (3.15)', runCase('list', async (check) => {
      const path = t.adapter.routes.list.replace(/([?&])page=:page(&|$)/, (m, before, after) => (after ? before : ''));
      const { res, body } = await listed(path);
      check('3.15', res.status === 200 && body !== null && typeof body === 'object' && !Array.isArray(body) && 'error' in body, `${path}: 200 {error} expected, got ${t.what(res)}`);
    }));
  });
};
