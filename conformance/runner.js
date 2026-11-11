/**
 * What the slices share: the rule ids an adapter may declare, the case
 * runner that turns failures of declared rules into pending tests, and the
 * final check that every declared difference still differs.
 */
const assert = require('assert');

/** Slice 1's rules (accessMatrix.js) */
const ACCESS_RULES = [
  '1.1', '1.2', '1.4', '1.5', '1.5/status', '1.6', '1.6/status', '1.7', '1.8', '1.9', '1.10',
  '1.11', '1.12', '1.14', '1.15', '2.1', '2.1/status', '2.2', '2.22', '3.1', '3.3'
];

/** Slice 2's rules (projectLifecycle.js) */
const LIFECYCLE_RULES = [
  '2.1', '2.1/status', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9', '2.10', '2.12',
  '2.13', '2.14', '2.15', '2.16', '2.17', '2.18', '2.19', '2.20', '2.22', '2.23', '2.24', '2.25'
];

/** Slice 3's rules (projectListings.js) */
const LISTING_RULES = ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8'];

/** Every rule an adapter may declare (besides `route:<name>`): one adapter serves every slice */
const RULES = [...new Set([...ACCESS_RULES, ...LIFECYCLE_RULES, ...LISTING_RULES])];

/**
 * Throw on a declared rule that no slice knows
 * @param {object} diffs expectedDifferences
 * @returns {void}
 */
const checkDeclared = (diffs) => {
  for (const key of Object.keys(diffs)) {
    if (!key.startsWith('route:') && !RULES.includes(key)) {
      throw new Error(`expectedDifferences: unknown rule "${key}" (known: ${RULES.join(', ')})`);
    }
  }
};

/*
 * What the slices run with one app adapter share: the tally of every rule,
 * and which slice judges whether a declared rule still differs. A rule two
 * slices check (3.1, 3.3: slices 1 and 3) is judged by the last slice
 * defined, which mocha runs last, on both slices' cases.
 */
const shared = new WeakMap();

/**
 * The case runner of a slice
 * @param {object} adapter The resolved adapter (adapter.js)
 * @param {object} [appAdapter] The app's adapter, the same object for every slice (default: the resolved one)
 * @param {Array<string>} [sliceRules] The rules of the slice (default: every rule)
 * @returns {object} `runCase(routeName, body)`: a mocha test function; `stillDiffers(it)`: the final check
 */
const caseRunner = (adapter, appAdapter = adapter, sliceRules = RULES) => {
  const diffs = adapter.expectedDifferences;
  if (!shared.has(appAdapter)) {
    shared.set(appAdapter, { tally: new Map(), judge: new Map() });
  }
  const { tally, judge } = shared.get(appAdapter);
  const slice = Symbol('slice');
  sliceRules.forEach((rule) => judge.set(rule, slice));

  /* Run one case: failures of declared rules make it pending ("known difference") */
  const runCase = (routeName, body) => async function () {
    // eslint-disable-next-line no-invalid-this, consistent-this -- mocha passes the test context as this
    const test = this;
    if (adapter.routes[routeName] === null) {
      test.test.title += ` [not routed in this app: ${diffs[`route:${routeName}`]}]`;
      test.skip();
    }
    const failures = [];
    const check = (rule, ok, what) => {
      const t = tally.get(rule) || { ran: 0, failed: 0 };
      t.ran += 1;
      if (!ok) {
        t.failed += 1;
        failures.push({ rule, what });
      }
      tally.set(rule, t);
    };
    await body(check);
    if (failures.length === 0) {
      return;
    }
    const text = failures.map((f) => `[${f.rule}] ${f.what}`).join('; ');
    if (failures.some((f) => !diffs[f.rule])) {
      throw new assert.AssertionError({ message: text });
    }
    test.test.title += ` [known difference ${[...new Set(failures.map((f) => f.rule))].join(', ')}: ${text}]`;
    test.skip();
  };

  /* The last test of a slice, in a describe of its own: mocha runs a suite's tests before its child suites */
  const stillDiffers = (it) => it('every declared difference still differs', function () {
    const gone = Object.keys(diffs)
      .filter((rule) => judge.get(rule) === slice && tally.has(rule) && tally.get(rule).failed === 0);
    assert.deepStrictEqual(gone, [], `these declared differences no longer differ, remove them from expectedDifferences: ${gone.join(', ')}`);
  });

  return { runCase, stillDiffers };
};

module.exports = { ACCESS_RULES, LIFECYCLE_RULES, LISTING_RULES, RULES, caseRunner, checkDeclared };
