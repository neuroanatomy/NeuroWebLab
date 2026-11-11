/**
 * The reference app's save (test/conformanceApp.js), following slice 2's
 * approved rules (coordination tasks/proposed-shared-pm-tests.md). Each
 * `broken` option turns one rule off, so the suite's own test can show the
 * suite catches it.
 */
const { AccessControlService: ACS, AccessLevel } = require('../index');

const LIST_TYPES = ['files', 'collaborators', 'annotations'];
const LAYER_TYPES = ['volume'];
const SHORTNAME = /^[a-zA-Z0-9-]+$/;
const clone = (o) => JSON.parse(JSON.stringify(o));
const nameOf = (c) => (c && (c.username || c.userID)) || '';
const isAnyone = (c) => nameOf(c) === 'anyone';
const blank = (v) => typeof v !== 'string' || v.trim() === '';
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* What a row is compared on, to tell a stored row from a new or changed one */
const rowKey = {
  files: (f) => JSON.stringify([f.source, f.name]),
  collaborators: (c) => JSON.stringify([nameOf(c), LIST_TYPES.map((type) => c.access && c.access[type])]),
  annotations: (a) => JSON.stringify([a.type, a.name, a.values])
};
const isBlankRow = {
  files: (f) => blank(f.source) && blank(f.name),
  collaborators: (c) => blank(nameOf(c)),
  annotations: (a) => blank(a.name) && blank(a.values)
};

/**
 * @param {object} broken The rules turned off
 * @returns {object} The checks
 */
// eslint-disable-next-line max-lines-per-function
const rules = (broken) => {
  const text = (s) => (broken.sanitizeJSON ? s.replace(/&/g, '&amp;') : s).replace(/<[^>]*>/g, '');
  const sanitize = (v) => {
    if (typeof v === 'string') { return text(v); }
    if (Array.isArray(v)) { return v.map(sanitize); }
    if (v && typeof v === 'object') { return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitize(x)])); }

    return v;
  };
  const validLevel = (v) => (broken.accessSubstring ? (/none|view|edit|add|remove/).test(v) : AccessLevel.values.includes(v));
  const rowError = {
    files: (f) => (typeof f.source !== 'string' || !(/^https?:\/\//).test(f.source) || typeof f.name !== 'string') && 'invalid file',
    collaborators: (c) => (blank(nameOf(c)) && 'a collaborator needs a name') ||
      (!LIST_TYPES.every((type) => validLevel(c.access && c.access[type])) && 'invalid access values'),
    annotations: (a) => (!LAYER_TYPES.includes(a.type) && 'invalid layer type') ||
      (!broken.noLayerNames && blank(a.name) && 'a layer needs a name')
  };

  /* Stored rows are kept as they are, blank new rows dropped (2.14) */
  const sortRows = (type, rows, oldRows) => {
    const available = oldRows.map(rowKey[type]);
    const kept = [];
    const stored = new Set();
    for (const row of rows) {
      const at = available.indexOf(rowKey[type](row));
      if (at >= 0 && !broken.validateStoredRows) {
        available.splice(at, 1);
        stored.add(kept.length);
        kept.push(row);
      } else if (!isBlankRow[type](row) || broken.validateStoredRows) {
        kept.push(row);
      }
    }

    return { kept, stored };
  };

  const duplicate = (layers, stored) => !broken.noLayerNames && layers.some((a, i) => !stored.has(i) && !blank(a.name) &&
    layers.some((b, k) => k !== i && (k < i || stored.has(k)) && !blank(b.name) && sameName(a.name, b.name)));

  // eslint-disable-next-line complexity
  const structureError = (doc, { shortname, isNew, stored }) => {
    if (!broken.shortnameFromBody && doc.shortname !== shortname) { return 'the shortname differs from the URL'; }
    if (isNew && !SHORTNAME.test(String(doc.shortname))) { return 'invalid shortname'; }
    for (const type of LIST_TYPES) {
      const error = doc[type].list.map((r, i) => !stored[type].has(i) && rowError[type](r)).find(Boolean);
      if (error) { return error; }
    }
    if (duplicate(doc.annotations.list, stored.annotations)) { return 'two layers have the same name'; }
    if (!broken.noAnyone && !doc.collaborators.list.some(isAnyone)) { return 'no anyone row'; }

    return null;
  };

  /* The users that must exist: a new project's owner, the rows the stored project lacks (2.9) */
  const usersToCheck = (doc, old, stored) => {
    const known = old ? old.collaborators.list.map(nameOf) : [];
    const rows = doc.collaborators.list
      .filter((c, i) => broken.usersEveryRow || (!stored.has(i) && !known.includes(nameOf(c))))
      .map(nameOf)
      .filter((n) => n !== 'anyone');

    return old && !broken.usersEveryRow ? rows : [doc.owner, ...rows];
  };

  /**
   * Parse, sanitise and validate a document
   * @param {object} params {data, shortname (the URL's), old (stored), who, userExists}
   * @returns {Promise<object>} {doc} or {error}
   */
  // eslint-disable-next-line max-statements
  const checkDocument = async ({ data, shortname, old, who, userExists }) => {
    const parsed = typeof data === 'string' ? (() => { try { return JSON.parse(data); } catch (e) { return null; } })() : data;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !LIST_TYPES.every((type) => parsed[type] && Array.isArray(parsed[type].list))) {
      return { error: 'invalid project data' };
    }
    const doc = sanitize(parsed);
    if (!broken.keepClientFields) {
      delete doc._id;
      delete doc.backup;
    }
    const stored = {};
    for (const type of LIST_TYPES) {
      ({ kept: doc[type].list, stored: stored[type] } = sortRows(type, doc[type].list, old ? old[type].list : []));
    }
    const error = structureError(doc, { shortname, isNew: !old, stored });
    if (error) { return { error }; }
    if (!broken.ownerFromClient) {
      doc.owner = old ? old.owner : who;
    }
    const missing = (await Promise.all(usersToCheck(doc, old, stored.collaborators).map(async (n) => (await userExists(n) ? null : n)))).filter(Boolean);

    return missing.length > 0 ? { error: `unknown users: ${missing.join(', ')}` } : { doc };
  };

  /* Lists changed in place keep their stored version without `edit` on them (2.4) */
  const keepInPlace = (doc, old, who) => LIST_TYPES.filter((type) => {
    const changed = doc[type].list.map(rowKey[type]).join() !== old[type].list.map(rowKey[type]).join();
    if (changed && !broken.noInPlaceCheck && !ACS.hasAccess(type, AccessLevel.EDIT, old, who)) {
      doc[type].list = old[type].list;

      return true;
    }

    return false;
  });

  return { checkDocument, keepInPlace };
};

/* The fields of a stored version a new version starts from (2.17) */
const storedFields = (stored) => {
  const fields = clone(stored);
  delete fields._id;
  delete fields.backup;

  return fields;
};

/**
 * The save handler, POST /project/json/:p
 * @param {object} store The projects (conformanceApp.js)
 * @param {object} broken The rules turned off
 * @param {function(string): Promise<boolean>} userExists Whether a user exists
 * @returns {function} An async express handler
 */
const saveHandler = (store, broken, userExists) => {
  const { checkDocument, keepInPlace } = rules(broken);
  let queue = Promise.resolve();
  // one save at a time (2.20)
  const locked = (fn) => {
    queue = queue.then(fn, fn);

    return queue;
  };

  // eslint-disable-next-line max-statements
  const save = async (req, res, who) => {
    const old = store.current(req.params.p);
    if (old && !broken.noEditCheck && !ACS.canEditFiles(old, who)) {
      return res.status(403).json({ error: 'User does not have edit rights' });
    }
    const { doc, error } = await checkDocument({ data: req.body.data, shortname: req.params.p, old, who, userExists });
    if (error) {
      return res.status(broken.invalid500 ? 500 : 400).json({ error });
    }
    const ignored = [];
    if (old) {
      ignored.push(...(broken.lengthsOnly ? [] : ACS.preventUnauthorizedUpdates(doc, old, who)), ...keepInPlace(doc, old, who));
    }
    const base = old || (broken.inheritDeleted ? store.last(doc.shortname) : null);
    const version = base && !broken.dropStoredFields ? { ...storedFields(base), ...doc } : doc;
    if (old || !broken.modifiedOnUpdateOnly) {
      version.modified = new Date().toJSON();
      version.modifiedBy = who;
    }
    store.saveVersion(version);
    res.json({ success: true, message: ignored.length ? `Some changes (on ${[...new Set(ignored)].join(', ')}) were ignored.` : 'Saved.' });
  };

  return async (req, res) => {
    if (!req.user && !broken.noLogin) {
      return res.status(broken.loggedOut403 ? 403 : 401).json({ error: 'User not authenticated' });
    }
    await locked(() => save(req, res, req.user ? req.user.username : 'anonymous'));
  };
};

module.exports = { clone, saveHandler };
