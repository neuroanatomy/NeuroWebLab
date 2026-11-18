/**
 * The reference app's save (test/conformanceApp.js), following slice 2's
 * approved rules (coordination tasks/proposed-shared-pm-tests.md). Each
 * `broken` option turns one rule off, so the suite's own test can show the
 * suite catches it. The validation is NWL's validateProject (1.20.0) with the
 * app's rules; the variants of a check the core makes are applied around it.
 */
const _ = require('lodash');
const {
  AccessControlService: ACS, AccessLevel, canSaveProject, ignoredChangesMessage, filesListIncomplete, keepFieldsWithoutFilesEdit, keepListsWithoutEditRights,
  parseProjectData, projectKey, projectSaveRoute, saveRefusal, validateProject, withLock
} = require('../index');

const LIST_TYPES = ['files', 'collaborators', 'annotations'];
const LAYER_TYPES = ['volume'];
const clone = (o) => JSON.parse(JSON.stringify(o));
const nameOf = (c) => (c && (c.username || c.userID)) || '';
const isAnyone = (c) => nameOf(c) === 'anyone';
const blank = (v) => typeof v !== 'string' || v.trim() === '';

/* What a row is compared on, to tell a stored row from a new or changed one */
const rowKey = {
  files: (f) => JSON.stringify(f && [f.source, f.name]),
  collaborators: (c) => JSON.stringify(c && [nameOf(c), LIST_TYPES.map((type) => c.access && c.access[type])]),
  annotations: (a) => JSON.stringify(a && [a.type, a.name, a.values])
};

/* A blank row (2.14) names nothing: a value that is missing or spaces, not one of another type (2.28) */
const empty = (v) => v === null || typeof v === 'undefined' || (typeof v === 'string' && v.trim() === '');
const isBlankRow = {
  files: (f) => Boolean(f) && typeof f === 'object' && empty(f.source) && empty(f.name),
  collaborators: (c) => Boolean(c) && typeof c === 'object' && empty(c.username) && empty(c.userID),
  annotations: (a) => Boolean(a) && typeof a === 'object' && empty(a.name) && empty(a.values)
};
const isObject = (o) => Boolean(o) && typeof o === 'object' && !Array.isArray(o);
const mapStrings = (v, fn) => {
  if (typeof v === 'string') { return fn(v); }
  if (Array.isArray(v)) { return v.map((x) => mapStrings(x, fn)); }
  if (isObject(v)) { return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)])); }

  return v;
};
const rowsOf = (doc, type) => (isObject(doc[type]) && Array.isArray(doc[type].list) ? doc[type].list : []);

/*
 * What each `broken` variant of the validation changes around NWL's
 * validateProject (1.20.0), which the app calls with its own rules: the
 * variants that turn off one of the core's checks change the document before
 * it, or the answer after it, so that the check has nothing to refuse.
 */
const before = {
  // 2.12: "&" escaped as in HTML (then kept by the sanitising, which leaves a string without "<")
  sanitizeJSON: (doc) => mapStrings(doc, (str) => str.replace(/&/g, '&amp;')),
  // 2.8: a value that contains a level is read as that level
  accessSubstring: (doc) => {
    for (const c of rowsOf(doc, 'collaborators').filter((r) => isObject(r) && isObject(r.access))) {
      for (const type of LIST_TYPES) {
        const level = String(c.access[type]).match(/none|view|edit|add|remove/);
        c.access[type] = level && !AccessLevel.values.includes(c.access[type]) ? level[0] : c.access[type];
      }
    }

    return doc;
  },
  // 2.27: a missing list is an empty one
  listsOptional: (doc) => {
    for (const type of LIST_TYPES.filter((t) => !(isObject(doc[t]) && Array.isArray(doc[t].list)))) {
      doc[type] = { list: [] };
    }

    return doc;
  },
  // 2.28: a row that is not an object, or names its user with something else than a string, is dropped
  badRowsDropped: (doc) => {
    if (isObject(doc.collaborators) && Array.isArray(doc.collaborators.list)) {
      doc.collaborators.list = doc.collaborators.list.filter((c) => isObject(c) && ['username', 'userID'].every((k) => typeof c[k] === 'undefined' || typeof c[k] === 'string'));
    }

    return doc;
  },
  // 2.29: a row with a different username and userID is read by its userID
  differentKeysAllowed: (doc) => {
    for (const c of rowsOf(doc, 'collaborators').filter((r) => isObject(r) && r.username && r.userID && r.username !== r.userID)) {
      delete c.username;
    }

    return doc;
  },
  // 2.30: a name, description or url that is not a string is not stored
  fieldTypesUnchecked: (doc) => {
    for (const field of ['name', 'description', 'url'].filter((f) => typeof doc[f] !== 'undefined' && typeof doc[f] !== 'string')) {
      delete doc[field];
    }

    return doc;
  }
};

/**
 * @param {object} broken The rules turned off
 * @returns {object} The checks
 */
// eslint-disable-next-line max-lines-per-function
const rules = (broken) => {
  const text = (s) => (broken.sanitizeJSON ? s.replace(/&/g, '&amp;') : s).replace(/<[^>]*>/g, '');
  const sanitize = (v) => mapStrings(v, text);

  /* The app's rules for NWL's validateProject: its file and layer checks; `validateStoredRows`: no row is stored, none blank */
  const appRules = {
    rowKey: _.fromPairs(LIST_TYPES.map((type) => [type, (r) => (broken.validateStoredRows ? { never: Symbol('new') } : rowKey[type](r))])),
    isBlankRow: _.fromPairs(LIST_TYPES.map((type) => [type, (r) => !broken.validateStoredRows && isBlankRow[type](r)])),
    collaboratorUser: nameOf,
    fileError: (f) => ((!isObject(f) || typeof f.source !== 'string' || !(/^https?:\/\//).test(f.source) || typeof f.name !== 'string') ? 'invalid file' : null),
    // `noLayerNames`: no name check (the core still refuses two layers named alike)
    layerError: (a) => {
      if (!isObject(a) || !LAYER_TYPES.includes(a.type)) { return 'invalid layer type'; }

      return !broken.noLayerNames && blank(a.name) ? 'a layer needs a name' : null;
    },
    fieldsError: () => null,
    projectError: () => null
  };

  /**
   * Parse, sanitise and validate a document: NWL's validateProject, with the variants around it
   * @param {object} params {data, shortname (the URL's), old (stored), who, userExists}
   * @returns {Promise<object>} {doc} or {error}
   */
  // eslint-disable-next-line max-statements, complexity
  const checkDocument = async ({ data, shortname, old, who, userExists }) => {
    let sent = parseProjectData(data);
    if (sent) {
      sent = clone(sent);
      for (const [option, change] of Object.entries(before)) {
        sent = broken[option] ? change(sent) : sent;
      }
    }
    // `noAnyone`: an anyone row is added for the check, and removed after
    const added = broken.noAnyone && sent && isObject(sent.collaborators) && Array.isArray(sent.collaborators.list) && !sent.collaborators.list.some(isAnyone);
    if (added) {
      sent.collaborators.list.push({ username: 'anyone', userID: 'anyone', access: { files: 'none', annotations: 'none', collaborators: 'none' }, added: true });
    }
    const findMissingUsers = async (names) => (await Promise.all(names.map(async (n) => (await userExists(n) ? null : n)))).filter(Boolean);
    const owner = old ? old.owner : who;
    const { project: doc, error } = await validateProject(sent || data, {
      shortname: broken.shortnameFromBody && sent ? sent.shortname : shortname,
      oldProject: old,
      // `ownerFromClient`: the client's owner (none: the core refuses the document)
      owner: broken.ownerFromClient ? sent && sent.owner : owner,
      findMissingUsers,
      rules: appRules
    });
    if (error) { return { error }; }
    if (added) {
      doc.collaborators.list = doc.collaborators.list.filter((c) => !c.added);
    }
    if (broken.keepClientFields) {
      Object.assign(doc, _.pick(sent, ['_id', 'backup']));
    }
    // `usersEveryRow`: every row and the owner must exist, stored or not (2.9)
    if (broken.usersEveryRow) {
      const missing = await findMissingUsers([doc.owner, ...doc.collaborators.list.map(nameOf).filter((n) => n !== 'anyone')]);
      if (missing.length > 0) { return { error: `unknown users: ${missing.join(', ')}` }; }
    }

    return { doc };
  };

  /*
   * The rights each list's changes need (2.3, 2.4, 2.26): NWL's keepListsWithoutEditRights
   * (1.19.0), with the rowKey above. Each variant drops one part of the rule:
   * - lengthsOnly: no length check, only `edit` on a list that differs (in order);
   * - noInPlaceCheck: only the lengths (NWL's preventUnauthorizedUpdates);
   * - unorderedRows: the lengths, and `edit` on a list that differs ignoring the order.
   */
  const keepChanged = (doc, old, who, { unordered = false } = {}) => LIST_TYPES.filter((type) => {
    const keys = (rows) => (unordered ? rows.map(rowKey[type]).sort() : rows.map(rowKey[type])).join();
    if (keys(doc[type].list) !== keys(old[type].list) && !ACS.hasAccess(type, AccessLevel.EDIT, old, who)) {
      doc[type].list = old[type].list;

      return true;
    }

    return false;
  });
  const keepLists = (doc, old, who) => {
    if (broken.lengthsOnly) {
      return keepChanged(doc, old, who);
    }
    if (broken.noInPlaceCheck) {
      return ACS.preventUnauthorizedUpdates(doc, old, who);
    }
    if (broken.unorderedRows) {
      return [...ACS.preventUnauthorizedUpdates(doc, old, who), ...keepChanged(doc, old, who, { unordered: true })];
    }

    return keepListsWithoutEditRights(doc, old, who, { rowKey });
  };

  return { checkDocument, keepLists, sanitize };
};

/* The fields of a stored version a new version starts from (2.17) */
const storedFields = (stored) => {
  const fields = clone(stored);
  delete fields._id;
  delete fields.backup;

  return fields;
};

/**
 * The save handler, POST /project/json/:projectName: NWL's projectSaveRoute
 * (1.21.0) around the save; `noLogin` and `loggedOut403` answer before it
 * @param {object} store The projects (conformanceApp.js)
 * @param {object} broken The rules turned off
 * @param {function(string): Promise<boolean>} userExists Whether a user exists
 * @returns {function} An async express handler
 */
const saveHandler = (store, broken, userExists) => {
  const { checkDocument, keepLists, sanitize } = rules(broken);
  // one save at a time (2.20): the project's lock
  const lockKeys = (req) => [projectKey(req.params.projectName)];

  // eslint-disable-next-line max-statements
  const save = async (req, res, who) => {
    const old = store.current(req.params.projectName);
    // edit on at least one list (2.2, 2026-11-15); `filesEditToSave`: files edit, the rule before
    const maySave = broken.filesEditToSave ? ACS.canEditFiles : canSaveProject;
    if (old && !broken.noEditCheck && !maySave(old, who)) {
      return res.status(403).json(saveRefusal());
    }
    const { doc, error } = await checkDocument({ data: req.body.data, shortname: req.params.projectName, old, who, userExists });
    if (error) {
      return res.status(broken.invalid500 ? 500 : 400).json({ error });
    }
    // a files list sent before every file was received: the stored one (2.21), before the rights
    if (old && !broken.noFilesGuard && filesListIncomplete(doc, old)) {
      doc.files.list = old.files.list;
    }
    delete doc.filesLoaded;
    const ignored = [];
    if (old) {
      ignored.push(...keepLists(doc, old, who));
      // the project's own fields need files edit (2.2); `fieldsUnchecked`: stored whatever the rights
      if (!broken.fieldsUnchecked) {
        ignored.push(...keepFieldsWithoutFilesEdit(doc, old, who, { sanitize }));
      }
    }
    const base = old || (broken.inheritDeleted ? store.last(doc.shortname) : null);
    const version = base && !broken.dropStoredFields ? { ...storedFields(base), ...doc } : doc;
    if (old || !broken.modifiedOnUpdateOnly) {
      version.modified = new Date().toJSON();
      version.modifiedBy = who;
    }
    store.saveVersion(version);
    res.json({ success: true, message: `Saved.${ignoredChangesMessage(ignored)}` });
  };

  const route = projectSaveRoute({ lockKeys, save });

  return (req, res, next) => {
    if (!req.user && broken.loggedOut403) {
      return res.status(403).json({ error: 'User not authenticated' });
    }
    if (!req.user && broken.noLogin) {
      return withLock(lockKeys(req), () => save(req, res, 'anonymous')).catch(next);
    }

    return route(req, res, next);
  };
};

module.exports = { clone, saveHandler };
