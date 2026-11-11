/**
 * Slice 4 cases: in each project, every visitor reads the owner's annotation,
 * then writes a new value. A read shows the value, or no annotation when
 * refused (4.1, 4.2). A write is accepted and stored, or refused and nothing
 * stored, as the owner reads it before and after (4.3, 4.2, 4.4).
 */
const { levelsText } = require('./matrix');

/* What a read answered, for a message */
const shown = (got) => JSON.stringify(got);
const isRead = (got) => Boolean(got) && typeof got === 'object' && (got.refused === true || 'value' in got);
const valueOf = (got) => (isRead(got) && got.refused !== true ? got.value : null);

// eslint-disable-next-line max-lines-per-function
module.exports = (t) => {
  const { describe, it, runCase, PROJECTS } = t;

  /* The read, checked to be one the adapter may give */
  const read = async (check, rule, key, projectKey) => {
    const got = await t.read(key, projectKey);
    check(rule, isRead(got), `annotations.read must answer {refused: true} or {value}, got ${shown(got)}`);

    return got;
  };

  for (const [projectKey, project] of Object.entries(PROJECTS)) {
    const where = `in a project with anyone: annotations ${project.anyone.annotations}`;
    const roleText = (v) => `${v.role}${v.key && project.rows[v.key] ? ` [own row: ${levelsText(project.rows[v.key])}]` : ''}`;

    describe(`annotations ${where}`, function () {
      for (const v of t.visitorsOf(project)) {
        const rule = t.ruleOf(project, v.key, 'read');
        const may = t.mayRead(project, v.key);
        it(`${roleText(v)} ${may ? 'reads the annotation' : 'is refused the annotation'} (${rule})`, runCase('annotations', async (check) => {
          const got = await read(check, rule, v.key, projectKey);
          if (may) {
            check(rule, valueOf(got) === t.seeds[projectKey], `the owner's annotation (${t.seeds[projectKey]}) expected, got ${shown(got)}`);
          } else {
            check(rule, valueOf(got) === null, `no annotation expected, got ${shown(got)}`);
          }
        }));
      }

      for (const v of t.visitorsOf(project)) {
        const rule = t.ruleOf(project, v.key, 'write');
        const may = t.mayWrite(project, v.key);
        it(`${roleText(v)} ${may ? 'writes an annotation, stored' : 'is refused a write, nothing stored'} (${rule})`, runCase('annotations', async (check) => {
          const before = await read(check, rule, 'owner', projectKey);
          const value = t.nextValue();
          const accepted = await t.write(v.key, projectKey, value);
          check(rule, typeof accepted === 'boolean', `annotations.write must answer true or false, got ${JSON.stringify(accepted)}`);
          const after = await read(check, rule, 'owner', projectKey);
          if (may) {
            check(rule, accepted === true, 'the write was refused');
            check(rule, valueOf(after) === value, `${value} stored expected, the owner reads ${shown(after)}`);
          } else {
            check(rule, accepted === false, 'the write was accepted');
            check(rule, valueOf(after) === valueOf(before), `nothing stored expected: the owner read ${shown(before)} before, ${shown(after)} after`);
          }
        }));
      }
    });
  }
};
