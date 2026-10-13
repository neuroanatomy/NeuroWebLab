#!/usr/bin/env node
// Yearly Node upgrade reminder (run by .github/workflows/yearly-node-upgrade.yml).
//
// 0. Keepalive (every run): re-enables this workflow through the API, so GitHub doesn't
//    disable the schedule after 60 days without commits. A failure is only a warning.
//    Then the Node check runs only in November (scheduled runs) or when NODE_CHECK=true
//    (manual runs); otherwise the run logs "keepalive only" and exits successfully.
// 1. Finds the newest Node LTS major (nodejs.org/dist/index.json) and compares it
//    with this repo's .nvmrc.
// 2. Checks the unofficial linux-x64-glibc-217 builds (needed by the CentOS 7 servers).
// 3. If a move is due and no open `node-upgrade` issue exists, opens one.
//
// Environment:
//   NODE_CHECK         "true" always runs the Node check, "false" never, "auto" (default)
//                      only in November (UTC).
//   WORKFLOW_FILE      workflow to re-enable (default "yearly-node-upgrade.yml").
//   TODAY              ISO date overriding today's date (for local tests).
//   DRY_RUN            "true" prints the issue instead of creating it (default "false").
//   GITHUB_TOKEN       token with issues:write; without it, GitHub calls are skipped (dry run only).
//   GITHUB_REPOSITORY  owner/repo (set by Actions).
//   ASSIGNEES          comma-separated GitHub usernames (from vars.NODE_UPGRADE_ASSIGNEES).
//   NVMRC              path of the .nvmrc to read (default ".nvmrc"; for local tests).
//   GITHUB_STEP_SUMMARY  set by Actions; a short summary is appended to it.
//
// No dependencies: Node's built-in fetch only. Exits non-zero with a clear message on errors.

import { appendFile, readFile } from 'node:fs/promises';

const DIST_INDEX = 'https://nodejs.org/dist/index.json';
const UNOFFICIAL_INDEX = 'https://unofficial-builds.nodejs.org/download/release/index.json';
const GLIBC_217 = 'linux-x64-glibc-217';
const LABEL = 'node-upgrade';
const REPOS = ['NeuroWebLab', 'nwl-components', 'BrainBox', 'microdraw'];

const {env} = process;
const dryRun = String(env.DRY_RUN || 'false').toLowerCase() === 'true';
const token = env.GITHUB_TOKEN || '';
const repository = env.GITHUB_REPOSITORY || '';
const nodeCheck = String(env.NODE_CHECK || 'auto').toLowerCase();
const workflowFile = env.WORKFLOW_FILE || 'yearly-node-upgrade.yml';
const assignees = (env.ASSIGNEES || '').split(',').map((s) => s.trim().replace(/^@/, ''))
  .filter(Boolean);

class Failure extends Error {}

async function fetchWithRetry(url, options = {}, { tries = 3, what = url } = {}) {
  let lastError;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      if (res.status >= 500 && i < tries) {
        lastError = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
    }
    console.log(`  ${what}: attempt ${i} failed (${lastError.message}); retrying in ${5 * i} s`);
    await new Promise((r) => setTimeout(r, 5000 * i));
  }
  throw new Failure(`Could not reach ${what} after ${tries} attempts: ${lastError.message}`);
}

async function fetchJson(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) { throw new Failure(`${url} answered HTTP ${res.status} ${res.statusText}`); }
  try {
    return await res.json();
  } catch (err) {
    throw new Failure(`${url} did not return valid JSON: ${err.message}`);
  }
}

const major = (version) => Number(String(version).replace(/^v/, '')
  .split('.')[0]);

async function github(method, path, body) {
  const res = await fetchWithRetry(`https://api.github.com/repos/${repository}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  }, { what: `GitHub API ${method} ${path}` });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text.slice(0, 200);
  }

  return { status: res.status, ok: res.ok, data };
}

function issueBody({ target, current, latest, glibc, assigned, today }) {
  const deadline = `${today.getUTCFullYear() + 1}-05-01`;
  const glibcText = glibc.latestHasIt
    ? `**Available.** \`${latest}\` has a \`${GLIBC_217}\` build on unofficial-builds.nodejs.org.`
    : glibc.newestWithIt
      ? `**Not yet for the latest release.** \`${latest}\` has no \`${GLIBC_217}\` build; the newest Node ${target} with one is \`${glibc.newestWithIt}\`. Install that one on the servers, or wait for the build.`
      : `**Not available for Node ${target}.** No \`${GLIBC_217}\` build exists for any Node ${target} release. The servers (CentOS 7, glibc 2.17) cannot run Node ${target} until either the unofficial builds catch up or the servers move to a supported OS (Rocky Linux or AlmaLinux 9/10). Ask IT for the OS move now; the repos can still move to Node ${target} in CI, but don't deploy them until the servers can run it.`;

  const repoChecklist = REPOS.map((r) => `### ${r}
- [ ] \`.nvmrc\` → \`${target}\`
- [ ] \`package.json\` \`"engines": { "node": ">=${target}" }\` (and the lock file root)
- [ ] CI green on Node ${target} (\`actions/setup-node\` reads \`.nvmrc\`)
- [ ] canary job still on \`current\` (now Node ${target + 1}), \`continue-on-error: true\`
- [ ] all test suites pass locally on Node ${target} after a clean \`npm ci\``).join('\n\n');

  const serverChecklist = ['BrainBox', 'microdraw'].map((s) => `### ${s} server
- [ ] install Node ${target} with \`n\` from the unofficial glibc-217 builds, e.g. \`N_NODE_MIRROR=https://unofficial-builds.nodejs.org/download/release n --arch x64-glibc-217 install ${glibc.latestHasIt ? latest.slice(1) : glibc.newestWithIt ? glibc.newestWithIt.slice(1) : target}\`
- [ ] \`node -v\` shows ${target}.x
- [ ] \`npm ci\`
- [ ] build
- [ ] restart (if pm2 is used: \`pm2 update\` after switching Node), then check the site`).join('\n\n');

  return `This is the yearly reminder to move **all NAAT repos and both production servers** from Node ${current} to Node ${target}, the newest LTS.

## Why

Policy, agreed 2026-10-11, so we never again get stuck on an old Node (BrainBox spent years on Node 16):
- **One Node version everywhere: the current LTS.**
- **Declared once per repo** in \`.nvmrc\`; CI reads it (\`node-version-file: .nvmrc\`) and \`package.json\` has a matching \`engines.node\`. Moving Node means editing one line per repo.
- **A canary CI job** in each repo runs the tests on the next Node major (\`node-version: current\`, non-blocking), so breakage shows up early.
- **Fixed schedule:** every November, after the new even-numbered Node becomes LTS in October, move everything. Finish before the following May, a year before the old version's end of life.
- **No native addons** in production dependencies (the servers can't build them).

## Deadline

**${deadline}.**

## glibc-217 builds (servers)

Both production servers run CentOS 7 (glibc 2.17). Official Node builds need glibc 2.28 or newer, so the servers use the unofficial \`${GLIBC_217}\` builds.

${glibcText}

The real fix is moving both servers to a supported OS (Rocky Linux or AlmaLinux 9/10). If that hasn't happened yet, ask IT again: the unofficial builds may stop at any major.

## Order

Libraries first, then the apps, then the servers:
1. **NeuroWebLab** (library; tag a release)
2. **nwl-components** (library; publish to npm)
3. **BrainBox** and **microdraw** (bump the libraries, then Node)
4. the two servers, each just before deploying its app on Node ${target}

Keep the Node switch in each repo as its own commit, separate from dependency bumps.

## Repos

${repoChecklist}

## Servers

${serverChecklist}

## Assignees

${assigned.length ? assigned.map((a) => `@${a}`).join(', ') : '**Nobody assigned:** the repository variable `NODE_UPGRADE_ASSIGNEES` is empty. Set it in Settings → Secrets and variables → Actions → Variables (comma-separated GitHub usernames) so next year\'s issue is assigned.'}

---
Opened by the \`yearly-node-upgrade\` workflow (NeuroWebLab \`.github/workflows/yearly-node-upgrade.yml\`). Close this issue when every box is ticked.`;
}

async function summary(text) {
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) { await appendFile(env.GITHUB_STEP_SUMMARY, `${text}\n`); }
}

// Re-enable this workflow so its schedule survives 60 days without commits. Never fails the run.
async function keepalive() {
  if (!token || !repository) {
    console.log('Keepalive: no GITHUB_TOKEN/GITHUB_REPOSITORY, skipped.');

    return;
  }
  try {
    const res = await github('PUT', `/actions/workflows/${workflowFile}/enable`);
    if (res.ok) {
      console.log(`Keepalive: workflow ${workflowFile} enabled (HTTP ${res.status}).`);
    } else {
      console.log(`::warning::Keepalive: enabling ${workflowFile} failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
    }
  } catch (err) {
    console.log(`::warning::Keepalive: enabling ${workflowFile} failed: ${err.message}`);
  }
}

async function main() {
  const today = env.TODAY ? new Date(env.TODAY) : new Date();
  if (Number.isNaN(today.getTime())) {
    throw new Failure(`TODAY=${env.TODAY} is not a valid date`);
  }

  await keepalive();

  const november = today.getUTCMonth() === 10;
  const runCheck = nodeCheck === 'true' || (nodeCheck === 'auto' && november);
  if (!runCheck) {
    await summary(`Keepalive only: no Node check (${today.toISOString().slice(0, 10)}, NODE_CHECK=${nodeCheck}; the check runs in November or when forced by hand).`);

    return;
  }
  console.log(`Node check: ${nodeCheck === 'true' ? 'forced' : 'November'}. Mode: ${dryRun ? 'dry run (prints the issue, creates nothing)' : 'live'}`);

  let current;
  const nvmrcPath = env.NVMRC || '.nvmrc';
  try {
    current = major((await readFile(nvmrcPath, 'utf8')).trim());
  } catch (err) {
    throw new Failure(`Cannot read ${nvmrcPath}: ${err.message}`);
  }
  if (!Number.isInteger(current)) { throw new Failure(`${nvmrcPath} does not start with a Node major version`); }
  console.log(`This repo's .nvmrc: Node ${current}`);

  console.log(`Fetching ${DIST_INDEX}`);
  const dist = await fetchJson(DIST_INDEX);
  const lts = dist.filter((r) => Boolean(r.lts));
  if (!lts.length) { throw new Failure(`${DIST_INDEX} lists no LTS release; has its format changed?`); }
  const target = Math.max(...lts.map((r) => major(r.version)));
  const latest = dist.filter((r) => major(r.version) === target)
    .sort((a, b) => new Date(b.date) - new Date(a.date) || b.version.localeCompare(a.version, 'en', { numeric: true }))[0].version;
  console.log(`Newest LTS major: Node ${target} (${lts.find((r) => major(r.version) === target).lts}), latest release ${latest}`);

  console.log(`Fetching ${UNOFFICIAL_INDEX}`);
  const unofficial = await fetchJson(UNOFFICIAL_INDEX);
  const withGlibc = unofficial.filter((r) => major(r.version) === target && (r.files || []).includes(GLIBC_217));
  const glibc = {
    latestHasIt: withGlibc.some((r) => r.version === latest),
    newestWithIt: withGlibc[0]?.version || null
  };
  console.log(`${GLIBC_217} for ${latest}: ${glibc.latestHasIt ? 'yes' : 'no'}; newest Node ${target} with it: ${glibc.newestWithIt || 'none'}`);

  if (target <= current) {
    await summary(`Nothing to do: the repos are on Node ${current}, and the newest LTS is Node ${target}. Already on the latest LTS; the workflow checks again next November.`);

    return;
  }

  const title = `Yearly Node upgrade: move all NAAT repos to Node ${target}`;
  const body = issueBody({ target, current, latest, glibc, assigned: assignees, today });

  if (!token || !repository) {
    if (!dryRun) { throw new Failure('GITHUB_TOKEN and GITHUB_REPOSITORY are required to open the issue'); }
    console.log('No GITHUB_TOKEN/GITHUB_REPOSITORY: skipping the duplicate check and label lookup.');
  } else {
    const open = await github('GET', `/issues?state=open&labels=${LABEL}&per_page=10`);
    if (!open.ok) { throw new Failure(`Listing open '${LABEL}' issues failed: HTTP ${open.status} ${JSON.stringify(open.data)}`); }
    const existing = open.data.filter((i) => !i.pull_request);
    if (existing.length) {
      await summary(`An open '${LABEL}' issue already exists (#${existing[0].number}, "${existing[0].title}"): not opening another. ${existing[0].html_url}`);

      return;
    }
  }

  if (dryRun) {
    console.log(`\n--- Would create issue (label '${LABEL}', assignees: ${assignees.join(', ') || 'none'}) ---`);
    console.log(`Title: ${title}\n\n${body}\n--- end ---`);
    await summary(`Dry run: would open "${title}".`);

    return;
  }

  const label = await github('GET', `/labels/${LABEL}`);
  if (label.status === 404) {
    const made = await github('POST', '/labels', { name: LABEL, color: '026e00', description: 'Yearly move of all NAAT repos to the new Node LTS' });
    if (!made.ok) { throw new Failure(`Creating label '${LABEL}' failed: HTTP ${made.status} ${JSON.stringify(made.data)}`); }
    console.log(`Created label '${LABEL}'`);
  } else if (!label.ok) {
    throw new Failure(`Looking up label '${LABEL}' failed: HTTP ${label.status}`);
  }

  let created = await github('POST', '/issues', { title, body, labels: [LABEL], assignees });
  if (created.status === 422 && assignees.length) {
    // An assignee who isn't a collaborator makes GitHub reject the whole issue.
    console.log(`GitHub refused the assignees (${assignees.join(', ')}): ${JSON.stringify(created.data)}. Opening the issue unassigned.`);
    const note = `\n\n> **Note:** the workflow could not assign ${assignees.map((a) => `@${a}`).join(', ')} (not collaborators of this repo?). Check \`NODE_UPGRADE_ASSIGNEES\`.`;
    created = await github('POST', '/issues', { title, body: body + note, labels: [LABEL] });
  }
  if (!created.ok) { throw new Failure(`Creating the issue failed: HTTP ${created.status} ${JSON.stringify(created.data)}`); }
  await summary(`Opened #${created.data.number}: ${created.data.html_url}`);
}

main().catch((err) => {
  console.error(`::error::${err instanceof Failure ? err.message : `Unexpected error: ${err.stack || err}`}`);
  process.exit(1);
});
