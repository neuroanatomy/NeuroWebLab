/**
 * The reference app's annotation rules (test/conformanceApp.js), following
 * slice 4's approved rules (coordination tasks/proposed-shared-pm-tests.md,
 * "Slice 4: rules for the differing rows"). Each `broken` option turns one
 * rule off, so the suite's own test can show the suite catches it.
 */
const { AccessControlService: ACS, AccessLevel, AccessType } = require('../index');

/**
 * Whether a visitor has a level on a project's annotations (4.2: the own row
 * if there is one, else `anyone`; `maxLevel`: the highest, as on the lists)
 * @param {object} project The stored project
 * @param {string} who The visitor or 'anonymous'
 * @param {AccessLevel} level The level needed
 * @param {object} broken The rules turned off
 * @returns {boolean} Whether the visitor has it
 */
const mayAnnotate = (project, who, level, broken) => {
  if (broken.maxLevel) {
    return ACS.hasAccess(AccessType.ANNOTATIONS, level, project, who);
  }
  try {
    return ACS.getUserOrPublicAccessLevel(project, who, AccessType.ANNOTATIONS).isGreaterThanOrEqualTo(level);
  } catch (e) {
    // no row for the visitor nor for `anyone`
    return false;
  }
};

/**
 * Write the value of the annotation of a file in a project (4.3, 4.4): logged
 * in, then `annotations: edit`; the new value replaces the current one
 * @param {object} store The store
 * @param {object} broken The rules turned off
 * @param {function(object): string} who The visitor of a request
 * @returns {function} The handler
 */
const annotationWriteHandler = (store, broken, who) => (req, res) => {
  const { project, source, value } = req.body || {};
  const p = store.current(project);
  if (!p) {
    return res.status(404).json({ error: 'no project' });
  }
  let refusal = 0;
  if (!req.user && !broken.anonymousWrite) {
    refusal = 401;
  } else if (!broken.noWriteCheck && !mayAnnotate(p, who(req), broken.editNeedsAdd ? AccessLevel.ADD : AccessLevel.EDIT, broken)) {
    refusal = 403;
  }
  if (refusal && !broken.refusedStillStores) {
    return res.status(refusal).json({ error: 'not allowed' });
  }
  if (!broken.acceptedNotStored) {
    store.annotations.filter((a) => a.project === project && a.source === source && !a.backup).forEach((a) => { a.backup = true; });
    store.annotations.push({ project, source, value });
  }
  res.status(refusal || 200).json(refusal ? { error: 'not allowed' } : { success: true });
};

module.exports = { annotationWriteHandler, mayAnnotate };
