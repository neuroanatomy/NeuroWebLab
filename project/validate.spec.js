/* eslint-disable max-lines, no-await-in-loop -- one case per value, run in order */
const { assert } = require('chai');
const { validateProject, projectRowProblems, duplicateLayerNames, parseProjectData } = require('./validate');

const clone = (o) => JSON.parse(JSON.stringify(o));
const uniform = (level) => ({ files: level, annotations: level, collaborators: level });
const row = (name, level = 'view') => ({ username: name, userID: name, access: uniform(level) });
// undefined as a value (no-undefined)
let nothing;
const layer = (name, type = 'text') => ({ type, name, values: '' });

/* Rules as microdraw's: files {name, source}, layers text|vectorial */
const appRules = (more = {}) => ({
  collaboratorUser: (c) => (typeof c.username === 'string' && c.username.trim() !== '' ? c.username : c.userID),
  fileError: (f, i) => ((f && typeof f === 'object' && typeof f.source === 'string' && (/^https?:\/\//).test(f.source) && typeof f.name === 'string') ? null : `File ${i + 1} is invalid`),
  layerError: (a, i) => {
    if (!a || typeof a !== 'object' || !['text', 'vectorial'].includes(a.type)) {
      return `Annotation ${i + 1} has an invalid type`;
    }

    return typeof a.name === 'string' && a.name.trim() !== '' ? null : `Annotation ${i + 1} needs a name`;
  },
  fieldsError: () => null,
  projectError: () => null,
  ...more
});

const doc = (shortname = 'proj') => ({
  shortname,
  name: 'A project',
  description: 'Its description',
  url: '',
  owner: 'someone-else',
  files: { list: [{ source: 'https://example.org/a.svs', name: 'a.svs' }] },
  collaborators: { list: [row('anyone', 'none'), row('alice', 'edit')] },
  annotations: { list: [layer('Layer')] }
});

/* findMissingUsers stubs: the calls are recorded */
const users = (missing = []) => {
  const calls = [];
  const find = (names) => {
    calls.push(names);

    return Promise.resolve(names.filter((n) => missing.includes(n)));
  };

  return { calls, find };
};

const validate = (data, options = {}) => validateProject(data, {
  shortname: 'proj',
  oldProject: null,
  owner: 'creator',
  findMissingUsers: users().find,
  rules: appRules(),
  ...options
});

const rejection = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('a rejection was expected');
};

describe('project/validate.js: validateProject', () => {
  describe('1. parse', () => {
    it('accepts a plain object and a JSON string', async () => {
      assert.isUndefined((await validate(doc())).error);
      assert.isUndefined((await validate(JSON.stringify(doc()))).error);
    });

    it('answers "Invalid project data" for anything else, without throwing', async () => {
      for (const data of [nothing, null, 'not json', '[1]', [], 3, 'true']) {
        assert.deepStrictEqual(await validate(data), { error: 'Invalid project data' }, JSON.stringify(data));
      }
    });

    it('parseProjectData: the object, or undefined', () => {
      assert.deepStrictEqual(parseProjectData('{"a":1}'), { a: 1 });
      assert.isUndefined(parseProjectData('{'));
      assert.isUndefined(parseProjectData([]));
    });
  });

  describe('2. sanitise', () => {
    it('sanitises every string, and drops _id and backup', async () => {
      const sent = { ...doc(), _id: 'x', backup: true };
      sent.annotations.list[0].name = 'Marked <img src=x onerror=alert(1)> up';
      const { project } = await validate(sent);
      assert.notProperty(project, '_id');
      assert.notProperty(project, 'backup');
      assert.notInclude(project.annotations.list[0].name, '<');
      assert.match(project.annotations.list[0].name, /^Marked.*up$/);
    });
  });

  describe('3. stored rows', () => {
    it('accepts a stored row invalid as new, and refuses the same row new', async () => {
      const old = doc();
      old.annotations.list.push(layer(''), layer('layer'));
      old.collaborators.list[1].access.files = 'viewer';
      old.files.list.push({ source: 'data:text/html,x', name: 'x' });
      const res = await validate(clone(old), { oldProject: old, owner: 'creator' });
      assert.isUndefined(res.error);
      assert.deepStrictEqual([...res.stored.annotations], [0, 1, 2]);
      const fresh = await validate(clone(old));
      assert.isString(fresh.error);
    });

    it('compares the sent rows with the stored ones sanitised', async () => {
      const old = doc();
      old.annotations.list.push(layer('Bold <b>x</b>', 'nosuchtype'));
      const res = await validate(clone(old), { oldProject: old });
      assert.isUndefined(res.error);
      assert.isTrue(res.stored.annotations.has(1));
    });

    it('drops blank new rows and counts them', async () => {
      const sent = doc();
      sent.files.list.push({ source: '', name: '' });
      sent.collaborators.list.push({ username: '', userID: '', access: uniform('none') });
      sent.annotations.list.push({ type: 'text', name: ' ', values: '' }, { type: 'text', name: '', values: '' });
      const { project, dropped } = await validate(sent);
      assert.deepStrictEqual(dropped, { files: 1, collaborators: 1, annotations: 2 });
      assert.deepStrictEqual([project.files.list.length, project.collaborators.list.length, project.annotations.list.length], [1, 2, 1]);
    });

    it('uses rules.rowKey and rules.isBlankRow', async () => {
      const old = doc();
      old.annotations.list.push(layer('x', 'nosuchtype'));
      const sent = clone(old);
      sent.annotations.list[1].display = true;
      // the whole row by default: the display key makes it a new row
      assert.isString((await validate(clone(sent), { oldProject: old })).error);
      const rowKey = { annotations: (a) => ({ type: a.type, name: a.name }) };
      assert.isUndefined((await validate(clone(sent), { oldProject: old, rules: appRules({ rowKey }) })).error);
      const isBlankRow = { annotations: () => false };
      const blankKept = doc();
      blankKept.annotations.list.push({ type: 'text', name: '', values: '' });
      assert.match((await validate(blankKept, { rules: appRules({ isBlankRow }) })).error, /needs a name/);
    });
  });

  describe('4, 5. shortname and lists', () => {
    it('the body\'s shortname must be the URL\'s', async () => {
      assert.strictEqual((await validate(doc('other'))).error, 'The project shortname in the data differs from the one in the URL');
    });

    it('a new shortname matches shortnamePattern; a stored one is not checked', async () => {
      const bad = doc('with_underscore');
      assert.strictEqual((await validate(bad, { shortname: 'with_underscore' })).error, 'The project shortname can only contain letters, numbers and hyphens');
      assert.isUndefined((await validate(clone(bad), { shortname: 'with_underscore', oldProject: bad })).error);
      assert.isUndefined((await validate(doc('with-hyphen'), { shortname: 'with-hyphen' })).error);
    });

    it('each list is required', async () => {
      for (const type of ['files', 'collaborators', 'annotations']) {
        for (const value of [nothing, null, { list: 'x' }, []]) {
          const sent = doc();
          sent[type] = value;
          assert.strictEqual((await validate(sent)).error, `The project needs a ${type} list`, `${type}: ${JSON.stringify(value)}`);
        }
      }
    });

    it('the order: a bad shortname with a missing list answers the shortname', async () => {
      const sent = doc('other');
      delete sent.files;
      assert.match((await validate(sent)).error, /shortname/);
    });
  });

  describe('6. the project\'s own fields', () => {
    it('name, description and url are strings when present', async () => {
      for (const field of ['name', 'description', 'url']) {
        const sent = doc();
        sent[field] = 5;
        assert.strictEqual((await validate(sent)).error, `The project ${field} must be a string`);
      }
      const without = doc();
      delete without.url;
      assert.isUndefined((await validate(without)).error);
    });

    it('a stored non-string value is refused, unless rules.checkStoredFields is false', async () => {
      const old = { ...doc(), description: null };
      assert.strictEqual((await validate(clone(old), { oldProject: old })).error, 'The project description must be a string');
      const rules = appRules({ checkStoredFields: false });
      assert.isUndefined((await validate(clone(old), { oldProject: old, rules })).error);
      assert.isString((await validate({ ...clone(old), description: 5 }, { oldProject: old, rules })).error);
    });

    it('calls rules.fieldsError(project, { oldProject, isNew }) after the core\'s field checks; async is fine', async () => {
      const calls = [];
      const fieldsError = (project, params) => {
        calls.push([project, params]);

        return Promise.resolve(project.name === 'bad' ? 'Invalid name' : null);
      };
      const old = doc();
      await validate(clone(old), { oldProject: old, rules: appRules({ fieldsError }) });
      assert.strictEqual(calls.length, 1);
      assert.deepStrictEqual(calls[0][1], { oldProject: old, isNew: false });
      assert.strictEqual(calls[0][0].name, 'A project');
      assert.strictEqual((await validate({ ...doc(), name: 'bad' }, { rules: appRules({ fieldsError }) })).error, 'Invalid name');
      assert.match((await validate({ ...doc(), name: 5 }, { rules: appRules({ fieldsError }) })).error, /name must be a string/);
    });
  });

  describe('7. the rows not stored', () => {
    const withCollaborator = (c) => {
      const sent = doc();
      sent.collaborators.list.push(c);

      return sent;
    };

    it('a collaborator is a plain object with a user', async () => {
      assert.strictEqual((await validate(withCollaborator('bob'))).error, 'Collaborator 3 must be an object');
      assert.strictEqual((await validate(withCollaborator({ username: 42, userID: 42, access: uniform('view') }))).error, 'Collaborator 3 needs a username');
      // a row that names nobody is blank: dropped, not refused (3)
      assert.isUndefined((await validate(withCollaborator({ access: uniform('view') }))).error);
    });

    it('a different username and userID are refused, with microdraw\'s text', async () => {
      assert.strictEqual((await validate(withCollaborator({ username: 'bob', userID: 'carol', access: uniform('view') }))).error,
        'Collaborator 3 has a different username (bob) and userID (carol): they must be equal');
    });

    it('access values are one of AccessLevel.values for each list', async () => {
      for (const access of [nothing, 'view', { files: 'view', annotations: 'view' }, { ...uniform('view'), files: 'viewer' }]) {
        assert.match((await validate(withCollaborator({ username: 'bob', access }))).error, /^Collaborator bob has invalid access values \(allowed: none, view, edit, add, remove\)$/);
      }
    });

    it('calls rules.fileError(file, i) and rules.layerError(layer, i) on the new rows only', async () => {
      const seen = { files: [], layers: [] };
      const rules = appRules({
        fileError: (f, i) => {
          seen.files.push(i);

          return null;
        },
        layerError: (a, i) => {
          seen.layers.push([a.name, i]);

          return null;
        }
      });
      const old = doc();
      const sent = clone(old);
      sent.files.list.push({ source: 'https://example.org/b.svs', name: 'b.svs' });
      sent.annotations.list.push(layer('New'));
      await validate(sent, { oldProject: old, rules });
      assert.deepStrictEqual(seen, { files: [1], layers: [['New', 1]] });
    });

    it('answers the first error: files, then collaborators, then layers', async () => {
      const sent = doc();
      sent.files.list.push({ source: 'ftp://x', name: 'x' });
      sent.collaborators.list.push('bob');
      sent.annotations.list.push(layer('x', 'volume'));
      assert.strictEqual((await validate(clone(sent))).error, 'File 2 is invalid');
      sent.files.list.pop();
      assert.strictEqual((await validate(clone(sent))).error, 'Collaborator 3 must be an object');
      sent.collaborators.list.pop();
      assert.strictEqual((await validate(clone(sent))).error, 'Annotation 2 has an invalid type');
    });
  });

  describe('8. duplicate layer names', () => {
    it('a new layer named as an earlier or a stored one, ignoring case and spaces, is refused', async () => {
      const sent = doc();
      sent.annotations.list.push(layer(' layer '));
      assert.strictEqual((await validate(sent)).error, 'Annotation 2 has the same name as annotation 1: "layer" (names are compared ignoring case)');
      const old = doc();
      const later = clone(old);
      later.annotations.list.unshift(layer('LAYER'));
      assert.match((await validate(later, { oldProject: old })).error, /^Annotation 1 has the same name as annotation 2/);
    });

    it('stored duplicates are never reported', async () => {
      const old = doc();
      old.annotations.list.push(layer('layer'));
      assert.isUndefined((await validate(clone(old), { oldProject: old })).error);
    });

    it('duplicateLayerNames: microdraw\'s', () => {
      const list = [layer('A'), layer('a'), layer(''), layer(' A ')];
      assert.deepStrictEqual(duplicateLayerNames(list).map((p) => p.row), [1, 3]);
      // a new row named as a stored row after it is reported, the stored rows never
      assert.deepStrictEqual(duplicateLayerNames(list, new Set([1, 3])).map((p) => p.row), [0]);
      assert.deepStrictEqual(duplicateLayerNames(list, new Set([0, 1])).map((p) => p.row), [3]);
    });
  });

  describe('9, 10. anyone, and both keys on stored rows', () => {
    it('an anyone row is required, stored or new', async () => {
      const sent = doc();
      sent.collaborators.list.shift();
      assert.strictEqual((await validate(clone(sent))).error, 'The collaborators list needs an \'anyone\' entry');
      assert.strictEqual((await validate(clone(sent), { oldProject: sent })).error, 'The collaborators list needs an \'anyone\' entry');
    });

    it('an anyone row is one whose rules.collaboratorUser is anyone', async () => {
      const sent = doc();
      sent.collaborators.list[0] = { nickname: 'anyone', access: uniform('none') };
      // microdraw's reading: a row named by nickname alone names nobody
      assert.strictEqual((await validate(clone(sent))).error, 'Collaborator 1 needs a username');
      const collaboratorUser = (c) => c.userID || c.nickname || c.username;
      assert.isUndefined((await validate(clone(sent), { rules: appRules({ collaboratorUser }) })).error);
    });

    it('a stored row with a different username and userID is refused, unless rules.checkStoredKeys is false', async () => {
      const old = doc();
      old.collaborators.list[1].userID = 'alicia';
      assert.match((await validate(clone(old), { oldProject: old })).error, /^Collaborator 2 has a different username \(alice\) and userID \(alicia\)/);
      assert.isUndefined((await validate(clone(old), { oldProject: old, rules: appRules({ checkStoredKeys: false }) })).error);
    });
  });

  describe('11. rules.projectError', () => {
    it('is called with (project, { oldProject, isNew, stored }), may be async, and its text is the answer', async () => {
      const calls = [];
      const projectError = async (project, params) => {
        calls.push(params);
        await new Promise((resolve) => { setImmediate(resolve); });

        return project.annotations.list.some((a) => a.type === 'vectorial') ? null : 'Annotations must contain at least 1 vectorial entry';
      };
      const old = doc();
      const res = await validate(clone(old), { oldProject: old, rules: appRules({ projectError }) });
      assert.strictEqual(res.error, 'Annotations must contain at least 1 vectorial entry');
      assert.deepStrictEqual(Object.keys(calls[0]), ['oldProject', 'isNew', 'stored']);
      assert.strictEqual(calls[0].oldProject, old);
      assert.isFalse(calls[0].isNew);
      assert.deepStrictEqual([...calls[0].stored.annotations], [0]);
    });

    it('is not called when an earlier step refuses; a rejection is passed on', async () => {
      let called = false;
      await validate(doc('other'), { rules: appRules({ projectError: () => { called = true; } }) });
      assert.isFalse(called);
      const err = await rejection(validate(doc(), { rules: appRules({ projectError: () => Promise.reject(new Error('db down')) }) }));
      assert.strictEqual(err.message, 'db down');
    });
  });

  describe('12, 13. owner and users', () => {
    it('the owner is the one given, never the body\'s', async () => {
      assert.strictEqual((await validate(doc(), { owner: 'creator' })).project.owner, 'creator');
      const old = { ...doc(), owner: 'stored-owner' };
      assert.strictEqual((await validate({ ...clone(old), owner: 'thief' }, { oldProject: old, owner: 'stored-owner' })).project.owner, 'stored-owner');
      assert.strictEqual((await validate(doc(), { owner: '' })).error, 'The project has no owner');
    });

    it('a new project: findMissingUsers is called once, with the owner and each new user once, not anyone', async () => {
      const u = users();
      const sent = doc();
      sent.collaborators.list.push(row('bob'), row('alice', 'view'));
      await validate(sent, { findMissingUsers: u.find, owner: 'creator' });
      assert.deepStrictEqual(u.calls, [['creator', 'alice', 'bob']]);
    });

    it('an update: not the owner, not the stored rows, not the users the stored project has', async () => {
      const u = users();
      const old = doc();
      old.collaborators.list.push(row('gone'));
      const sent = clone(old);
      // alice's row changed: not stored, but alice is in the stored project
      sent.collaborators.list[1].access = uniform('view');
      sent.collaborators.list.push(row('bob'));
      await validate(sent, { oldProject: old, owner: 'creator', findMissingUsers: u.find });
      assert.deepStrictEqual(u.calls, [['bob']]);
    });

    it('any missing user gives "Unknown users: a, b"; a stored row of a removed user does not', async () => {
      const sent = doc();
      sent.collaborators.list.push(row('bob'), row('carol'));
      assert.strictEqual((await validate(sent, { findMissingUsers: users(['bob', 'carol']).find })).error, 'Unknown users: bob, carol');
      const old = doc();
      assert.isUndefined((await validate(clone(old), { oldProject: old, findMissingUsers: users(['alice']).find })).error);
    });

    it('a failing findMissingUsers is passed on', async () => {
      const err = await rejection(validate(doc(), { findMissingUsers: () => Promise.reject(new Error('no db')) }));
      assert.strictEqual(err.message, 'no db');
    });
  });

  describe('14. the result', () => {
    it('{ project, dropped, stored }, without _id or backup', async () => {
      const res = await validate({ ...doc(), _id: 1, backup: true });
      assert.deepStrictEqual(Object.keys(res).sort(), ['dropped', 'project', 'stored']);
      assert.notProperty(res.project, '_id');
      assert.notProperty(res.project, 'backup');
      assert.deepStrictEqual(res.dropped, { files: 0, collaborators: 0, annotations: 0 });
    });

    it('does not change the data or the stored project', async () => {
      const sent = doc();
      sent.files.list.push({ source: '', name: '' });
      const old = doc();
      const before = [clone(sent), clone(old)];
      await validate(sent, { oldProject: old });
      assert.deepStrictEqual([sent, old], before);
    });
  });

  describe('rules', () => {
    it('a missing hook with no default is a TypeError naming it', async () => {
      for (const name of ['collaboratorUser', 'fileError', 'layerError', 'fieldsError', 'projectError']) {
        const rules = appRules();
        delete rules[name];
        const err = await rejection(validate(doc(), { rules }));
        assert.instanceOf(err, TypeError);
        assert.include(err.message, `rules.${name}`);
      }
      assert.instanceOf(await rejection(validate(doc(), { rules: null })), TypeError);
      assert.instanceOf(await rejection(validate(doc(), { findMissingUsers: null })), TypeError);
    });

    it('a missing rowKey or isBlankRow takes the default; a non-object one is a TypeError', async () => {
      assert.isUndefined((await validate(doc(), { rules: appRules({ rowKey: nothing, isBlankRow: nothing }) })).error);
      assert.include((await rejection(validate(doc(), { rules: appRules({ rowKey: () => 1 }) }))).message, 'rules.rowKey');
    });
  });
});

describe('project/validate.js: projectRowProblems', () => {
  it('every problem of the rows, as if all new', () => {
    const project = doc();
    project.files.list.push({ source: 'ftp://x', name: 'x' });
    project.collaborators.list.push('bob', { username: 'a', userID: 'b', access: uniform('view') });
    project.annotations.list.push(layer(''), layer('layer'));
    assert.deepStrictEqual(projectRowProblems(project, appRules()), [
      { list: 'files', row: 1, message: 'File 2 is invalid' },
      { list: 'collaborators', row: 2, message: 'Collaborator 3 must be an object' },
      { list: 'collaborators', row: 3, message: 'Collaborator 4 has a different username (a) and userID (b): they must be equal' },
      { list: 'annotations', row: 1, message: 'Annotation 2 needs a name' },
      { list: 'annotations', row: 2, message: 'Annotation 3 has the same name as annotation 1: "layer" (names are compared ignoring case)' }
    ]);
  });

  it('agrees with validateProject: each problem is validateProject\'s answer for that row new', async () => {
    const rows = [
      ['files', { source: 'data:text/html,x', name: 'x' }],
      ['collaborators', 7],
      ['collaborators', { username: 'bob', access: uniform('viewer') }],
      ['annotations', layer('x', 'volume')],
      ['annotations', layer('Layer')]
    ];
    for (const [type, value] of rows) {
      const project = doc();
      project[type].list.push(value);
      const [problem] = projectRowProblems(clone(project), appRules());
      assert.strictEqual((await validate(clone(project))).error, problem.message, `${type} ${JSON.stringify(value)}`);
    }
    assert.deepStrictEqual(projectRowProblems(doc(), appRules()), []);
    assert.isUndefined((await validate(doc())).error);
  });

  it('a missing list has no rows; a missing row hook is a TypeError', () => {
    assert.deepStrictEqual(projectRowProblems({}, appRules()), []);
    const rules = appRules();
    delete rules.layerError;
    assert.throws(() => projectRowProblems(doc(), rules), TypeError, 'rules.layerError');
  });
});
