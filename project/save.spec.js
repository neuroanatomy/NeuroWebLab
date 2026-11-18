/* eslint-disable max-lines */
const { assert } = require('chai');
const Configuration = require('../Configuration');
const {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete,
  keepListsWithoutEditRights
} = require('./save');

const clone = (o) => JSON.parse(JSON.stringify(o));
const access = (files, annotations, collaborators) => ({ files, annotations, collaborators });

// the members of the apps' project-save-rights tests (microdraw project-save-rights.spec.js,
// BrainBox integration/project-save-rights.test.js), and the new ones of M2
const levels = {
  annotationsAdd: access('view', 'add', 'view'),
  annotationsEdit: access('view', 'edit', 'view'),
  annotationsRemove: access('view', 'remove', 'view'),
  collaboratorsAdd: access('view', 'view', 'add'),
  collaboratorsEdit: access('none', 'none', 'edit'),
  viewer: access('view', 'view', 'view'),
  filesEdit: access('edit', 'view', 'view'),
  squirrel: access('view', 'remove', 'remove'),
  nothing: access('none', 'none', 'none')
};
const row = (username, a) => ({ username, userID: username, name: username, access: a });

const stored = () => ({
  name: 'Save rights',
  shortname: 'save-rights',
  url: '',
  description: 'Stored description',
  created: '2026-11-15T00:00:00.000Z',
  owner: 'owner',
  collaborators: {
    list: [row('anyone', access('none', 'none', 'none')), ...Object.keys(levels).map((key) => row(key, levels[key]))]
  },
  files: { list: [{ source: '/test_data/cat.json', name: 'cat' }, { source: '/test_data/dog.json', name: 'dog' }] },
  annotations: { list: [{ type: 'vectorial', name: 'Layer', values: '10regions.json' }] }
});

// a sanitiser as the apps' (DOMPurify there): tags removed, & written as &amp;
const sanitize = (v) => {
  if (typeof v === 'string') { return v.replace(/<[^>]*>/g, '').replace(/&(?!amp;)/g, '&amp;'); }
  if (Array.isArray(v)) { return v.map(sanitize); }
  if (v && typeof v === 'object') { return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitize(x)])); }

  return v;
};

describe('project/save', () => {
  let savedProperties;

  before(() => {
    savedProperties = Configuration.getInstance().properties;
    Configuration.getInstance().setProperties({
      usernameField: 'username',
      usersCollection: 'users',
      projectsCollection: 'projects',
      annotationsCollection: 'annotations'
    });
  });

  after(() => {
    Configuration.getInstance().setProperties(savedProperties);
  });

  describe('canSaveProject: edit on at least one list', () => {
    for (const key of ['annotationsAdd', 'annotationsEdit', 'annotationsRemove', 'collaboratorsAdd', 'collaboratorsEdit', 'filesEdit', 'squirrel']) {
      it(`${key} (${JSON.stringify(levels[key])}) may save`, () => {
        assert.isTrue(canSaveProject(stored(), key));
      });
    }

    it('a member with annotations edit and files view may save', () => {
      assert.isTrue(canSaveProject(stored(), 'annotationsEdit'));
    });

    it('a member with view only may not save', () => {
      assert.isFalse(canSaveProject(stored(), 'viewer'));
    });

    it('a member with none everywhere may not save', () => {
      assert.isFalse(canSaveProject(stored(), 'nothing'));
    });

    it('the owner may save', () => {
      assert.isTrue(canSaveProject(stored(), 'owner'));
    });

    it('a non-member may save when anyone has edit on one list, not when anyone has view', () => {
      const p = stored();
      assert.isFalse(canSaveProject(p, 'outsider'));
      p.collaborators.list[0].access = access('view', 'edit', 'view');
      assert.isTrue(canSaveProject(p, 'outsider'));
    });

    it('a member found by userID only', () => {
      const p = stored();
      p.collaborators.list.push({ userID: 'byID', access: access('view', 'view', 'edit') });
      assert.isTrue(canSaveProject(p, 'byID'));
    });
  });

  describe('saveRefusal', () => {
    it('the 403 body: success false, the reason in error and in message', () => {
      const body = saveRefusal();
      assert.deepEqual(Object.keys(body).sort(), ['error', 'message', 'success']);
      assert.isFalse(body.success);
      assert.strictEqual(body.error, 'You may not change this project: saving it needs edit rights on its files, annotations or collaborators');
      assert.strictEqual(body.message, body.error);
      assert.match(body.error, /edit rights/);
    });

    it('a new object each time', () => {
      const a = saveRefusal();
      a.error = 'changed';
      assert.notStrictEqual(saveRefusal().error, 'changed');
    });
  });

  describe('ignoredChangesMessage', () => {
    it('names the lists and fields ignored, with a leading space', () => {
      assert.strictEqual(ignoredChangesMessage(['annotations', 'name']), ' Some changes (on annotations, name) were ignored due to a lack of permissions.');
    });

    it('is empty when nothing was ignored', () => {
      assert.strictEqual(ignoredChangesMessage([]), '');
      assert.strictEqual(ignoredChangesMessage(), '');
    });

    it('names each once', () => {
      assert.strictEqual(ignoredChangesMessage(['files', 'files']), ' Some changes (on files) were ignored due to a lack of permissions.');
    });
  });

  describe('keepFieldsWithoutFilesEdit', () => {
    it('without files edit: name, description, url and an unknown field changed are put back and reported; the lists are left alone', () => {
      const old = stored();
      const sent = clone(old);
      sent.name = 'Renamed project';
      sent.description = 'Changed';
      sent.url = 'https://example.org';
      sent.extra = 'not stored before';
      sent.annotations.list.push({ type: 'vectorial', name: 'Added', values: '10regions.json' });
      const ignored = keepFieldsWithoutFilesEdit(sent, old, 'annotationsAdd');
      assert.deepEqual(ignored, ['name', 'url', 'description', 'extra']);
      assert.strictEqual(sent.name, 'Save rights');
      assert.strictEqual(sent.description, 'Stored description');
      assert.strictEqual(sent.url, '');
      assert.notProperty(sent, 'extra');
      assert.deepEqual(sent.annotations.list.map((a) => a.name), ['Layer', 'Added']);
      assert.strictEqual(ignoredChangesMessage(ignored), ' Some changes (on name, url, description, extra) were ignored due to a lack of permissions.');
    });

    it('a member with annotations edit and files view: a layer renamed is left, a name change put back', () => {
      const old = stored();
      const sent = clone(old);
      sent.annotations.list[0].name = 'Renamed layer';
      sent.name = 'Renamed project';
      assert.deepEqual(keepFieldsWithoutFilesEdit(sent, old, 'annotationsEdit'), ['name']);
      assert.strictEqual(sent.name, 'Save rights');
      assert.strictEqual(sent.annotations.list[0].name, 'Renamed layer');
    });

    it('a member with view only: the name is put back too (canSaveProject refuses their save first)', () => {
      const old = stored();
      const sent = { ...clone(old), name: 'Renamed' };
      assert.deepEqual(keepFieldsWithoutFilesEdit(sent, old, 'viewer'), ['name']);
      assert.strictEqual(sent.name, 'Save rights');
    });

    it('with files edit: nothing is put back', () => {
      const old = stored();
      const sent = { ...clone(old), name: 'Renamed', extra: 1 };
      assert.deepEqual(keepFieldsWithoutFilesEdit(sent, old, 'filesEdit'), []);
      assert.strictEqual(sent.name, 'Renamed');
      assert.strictEqual(sent.extra, 1);
    });

    it('the owner: nothing is put back', () => {
      const old = stored();
      const sent = { ...clone(old), name: 'Renamed by the owner' };
      assert.deepEqual(keepFieldsWithoutFilesEdit(sent, old, 'owner'), []);
      assert.strictEqual(sent.name, 'Renamed by the owner');
    });

    it('a field sent empty that the stored project lacks is not reported', () => {
      const old = stored();
      delete old.url;
      const sent = { ...clone(old), url: '' };
      assert.deepEqual(keepFieldsWithoutFilesEdit(sent, old, 'annotationsEdit'), []);
      assert.strictEqual(sent.url, '');
    });

    it('the server\'s fields, the shortname and filesLoaded are not the project\'s own fields', () => {
      const old = stored();
      const sent = {
        ...clone(old), owner: 'x', shortname: 'other', _id: 'id', backup: true, modified: 'now', modifiedBy: 'x', filesLoaded: { count: 1 }
      };
      assert.deepEqual(keepFieldsWithoutFilesEdit(sent, old, 'annotationsEdit'), []);
      assert.strictEqual(sent.owner, 'x');
    });

    it('a stored value that the sanitiser changes: unchanged with `sanitize` (BrainBox), reported without (microdraw)', () => {
      const old = { ...stored(), description: 'Cats & dogs <b>bold</b>' };
      const sent = { ...clone(old), description: sanitize(old.description) };
      assert.deepEqual(keepFieldsWithoutFilesEdit(clone(sent), old, 'annotationsEdit', { sanitize }), []);
      const without = clone(sent);
      assert.deepEqual(keepFieldsWithoutFilesEdit(without, old, 'annotationsEdit'), ['description']);
      assert.strictEqual(without.description, old.description);
    });

    it('with `sanitize`, a real change is still put back', () => {
      const old = stored();
      const sent = { ...clone(old), name: 'Changed' };
      assert.deepEqual(keepFieldsWithoutFilesEdit(sent, old, 'annotationsEdit', { sanitize }), ['name']);
      assert.strictEqual(sent.name, 'Save rights');
    });
  });

  describe('filesListIncomplete', () => {
    const sentWith = (filesLoaded) => {
      const p = stored();
      p.files.list = [p.files.list[0]];
      if (typeof filesLoaded !== 'undefined') {
        p.filesLoaded = filesLoaded;
      }

      return p;
    };

    it('no stored files list: a count of 0 is complete, another count incomplete', () => {
      const old = stored();
      delete old.files;
      assert.isFalse(filesListIncomplete(sentWith({ count: 0 }), old));
      assert.isTrue(filesListIncomplete(sentWith({ count: 1 }), old));
    });

    it('no stored project: nothing to keep', () => {
      assert.isFalse(filesListIncomplete(sentWith({ count: 1 }), null));
    });

    it('the count equal to the stored list\'s length: complete', () => {
      assert.isFalse(filesListIncomplete(sentWith({ count: 2 }), stored()));
    });

    it('a different count: incomplete', () => {
      assert.isTrue(filesListIncomplete(sentWith({ count: 1 }), stored()));
      assert.isTrue(filesListIncomplete(sentWith({ count: 3 }), stored()));
    });

    it('filesLoaded not an object with a number: incomplete', () => {
      assert.isTrue(filesListIncomplete(sentWith(null), stored()));
      assert.isTrue(filesListIncomplete(sentWith({ count: '2' }), stored()));
      assert.isTrue(filesListIncomplete(sentWith(2), stored()));
    });

    it('no filesLoaded: complete', () => {
      assert.isFalse(filesListIncomplete(sentWith(), stored()));
    });

    it('changes neither project', () => {
      const sent = sentWith({ count: 1 });
      const old = stored();
      const [sentBefore, oldBefore] = [clone(sent), clone(old)];
      filesListIncomplete(sent, old);
      assert.deepEqual(sent, sentBefore);
      assert.deepEqual(old, oldBefore);
    });

    it('sets dropped.files to 0 when incomplete, and only then', () => {
      const dropped = { files: 2, collaborators: 1 };
      assert.isTrue(filesListIncomplete(sentWith({ count: 1 }), stored(), dropped));
      assert.deepEqual(dropped, { files: 0, collaborators: 1 });
      const kept = { files: 2 };
      assert.isFalse(filesListIncomplete(sentWith({ count: 2 }), stored(), kept));
      assert.deepEqual(kept, { files: 2 });
    });
  });

  // eslint-disable-next-line max-statements
  describe('keepListsWithoutEditRights: a longer list needs add, a shorter one remove, any other difference edit', () => {
    const TYPES = ['collaborators', 'files', 'annotations'];
    // a member per list and level, with view on the other lists: `${type}:${level}`
    const member = (type, level) => `${type}:${level}`;
    // view on every list
    const viewer = member('collaborators', 'view');
    const memberRows = TYPES.flatMap((type) => ['view', 'edit', 'add', 'remove'].map((level) => {
      const a = { files: 'view', annotations: 'view', collaborators: 'view' };
      a[type] = level;

      return row(member(type, level), a);
    }));
    const project = () => ({
      shortname: 'list-rights',
      owner: 'owner',
      collaborators: { list: [row('anyone', access('none', 'none', 'none')), ...memberRows] },
      files: { list: [{ source: '/a.json', name: 'a' }, { source: '/b.json', name: 'b' }, { source: '/c.json', name: 'c' }] },
      annotations: { list: [{ type: 'vectorial', name: 'One', values: 'r.json' }, { type: 'vectorial', name: 'Two', values: 'r.json' }] }
    });
    const extra = { collaborators: () => row('newcomer', access('view', 'view', 'view')), files: () => ({ source: '/d.json', name: 'd' }), annotations: () => ({ type: 'vectorial', name: 'Three', values: 'r.json' }) };
    // each change, and the level it needs
    const changes = {
      longer: { needs: 'add', without: 'edit', apply: (list, type) => list.push(extra[type]()) },
      shorter: { needs: 'remove', without: 'add', apply: (list) => list.pop() },
      'a row changed in place': { needs: 'edit', without: 'view', apply: (list, type) => { list[1] = type === 'files' ? { ...list[1], source: '/changed.json' } : { ...list[1], name: 'changed' }; } },
      'a move': { needs: 'edit', without: 'view', apply: (list) => { [list[0], list[1]] = [list[1], list[0]]; } }
    };
    // collaborators: a row changed in place changes its access (its name is not in microdraw's key)
    changes['a row changed in place'].collaborators = (list) => { list[1] = { ...list[1], access: { ...list[1].access, files: 'none' } }; };

    const sentWith = (type, change) => {
      const sent = project();
      (changes[change][type] || changes[change].apply)(sent[type].list, type);

      return sent;
    };

    for (const type of TYPES) {
      for (const change of Object.keys(changes)) {
        const { needs, without } = changes[change];
        it(`${type}, ${change}: stored with ${needs}`, () => {
          const sent = sentWith(type, change);
          const { list } = sent[type];
          assert.deepEqual(keepListsWithoutEditRights(sent, project(), member(type, needs)), []);
          assert.strictEqual(sent[type].list, list);
        });
        it(`${type}, ${change}: kept as stored without ${needs} (${without}), and named`, () => {
          const sent = sentWith(type, change);
          const old = project();
          assert.deepEqual(keepListsWithoutEditRights(sent, old, member(type, without)), [type]);
          assert.strictEqual(sent[type].list, old[type].list);
        });
      }
    }

    it('add implies edit: a longer list with a row changed in place is stored with add, not with edit', () => {
      const sent = sentWith('annotations', 'longer');
      sent.annotations.list[0].name = 'changed';
      assert.deepEqual(keepListsWithoutEditRights(clone(sent), project(), member('annotations', 'add')), []);
      assert.deepEqual(keepListsWithoutEditRights(clone(sent), project(), member('annotations', 'edit')), ['annotations']);
    });

    it('remove implies edit: a shorter list with a row changed in place is stored with remove, not with add', () => {
      const sent = sentWith('files', 'shorter');
      sent.files.list[0] = { source: '/changed.json', name: 'a' };
      assert.deepEqual(keepListsWithoutEditRights(clone(sent), project(), member('files', 'remove')), []);
      assert.deepEqual(keepListsWithoutEditRights(clone(sent), project(), member('files', 'add')), ['files']);
    });

    it('rowKey: a difference outside the key is no change; without rowKey, it is', () => {
      const rowKey = { collaborators: (c) => ({ user: c.username, access: c.access }) };
      const renamed = () => {
        const sent = project();
        sent.collaborators.list[1] = { ...sent.collaborators.list[1], name: 'A display name' };

        return sent;
      };
      const sent = renamed();
      assert.deepEqual(keepListsWithoutEditRights(sent, project(), viewer, { rowKey }), []);
      assert.strictEqual(sent.collaborators.list[1].name, 'A display name');
      const unkeyed = renamed();
      assert.deepEqual(keepListsWithoutEditRights(unkeyed, project(), viewer), ['collaborators']);
      assert.strictEqual(unkeyed.collaborators.list[1].name, member('collaborators', 'view'));
    });

    it('rowKey: a list without a key compares whole rows; a key that is not a function is a TypeError', () => {
      const sent = project();
      sent.files.list[0] = { ...sent.files.list[0], name: 'renamed' };
      assert.deepEqual(keepListsWithoutEditRights(sent, project(), viewer, { rowKey: { collaborators: (c) => c.username } }), ['files']);
      assert.throws(() => keepListsWithoutEditRights(project(), project(), viewer, { rowKey: { files: 'source' } }), TypeError, /rowKey\.files/);
    });

    describe('oldRows', () => {
      // the stored layer has markup, which the body's sanitiser removes (BrainBox's oldLists)
      const marked = () => {
        const old = project();
        old.annotations.list[0].name = '<b>One</b>';

        return old;
      };
      const oldRows = { annotations: project().annotations.list };

      it('the comparison uses oldRows when given: the stored rows as sanitised are no change', () => {
        const sent = project();
        assert.deepEqual(keepListsWithoutEditRights(sent, marked(), viewer, { oldRows }), []);
        assert.deepEqual(keepListsWithoutEditRights(project(), marked(), viewer), ['annotations']);
      });

      it('a list put back is the stored one, never oldRows', () => {
        const sent = project();
        sent.annotations.list.reverse();
        const old = marked();
        assert.deepEqual(keepListsWithoutEditRights(sent, old, viewer, { oldRows }), ['annotations']);
        assert.strictEqual(sent.annotations.list, old.annotations.list);
        assert.strictEqual(sent.annotations.list[0].name, '<b>One</b>');
      });

      it('a list oldRows lacks is compared with the stored rows', () => {
        const sent = project();
        sent.files.list.reverse();
        assert.deepEqual(keepListsWithoutEditRights(sent, project(), viewer, { oldRows }), ['files']);
      });
    });

    it('the result: the ignored lists in list order, each once', () => {
      const sent = project();
      sent.annotations.list.reverse();
      sent.files.list.push(extra.files());
      sent.files.list[0] = { source: '/changed.json', name: 'a' };
      sent.collaborators.list.pop();
      const old = project();
      assert.deepEqual(keepListsWithoutEditRights(sent, old, viewer), ['collaborators', 'files', 'annotations']);
      assert.strictEqual(sent.collaborators.list, old.collaborators.list);
      assert.strictEqual(sent.files.list, old.files.list);
      assert.strictEqual(sent.annotations.list, old.annotations.list);
    });

    it('the lists whose changes are allowed are untouched', () => {
      const some = project();
      some.annotations.list.reverse();
      some.files.list.reverse();
      const [collaborators, annotations] = [some.collaborators.list, some.annotations.list];
      assert.deepEqual(keepListsWithoutEditRights(some, project(), member('annotations', 'edit')), ['files']);
      assert.strictEqual(some.collaborators.list, collaborators);
      assert.strictEqual(some.annotations.list, annotations);
    });

    it('changes newProject in place, and neither oldProject nor its other fields', () => {
      const sent = { ...project(), name: 'Sent name' };
      sent.files.list.reverse();
      const old = project();
      const before = clone(old);
      keepListsWithoutEditRights(sent, old, viewer);
      assert.deepEqual(old, before);
      assert.strictEqual(sent.name, 'Sent name');
      assert.deepEqual(sent.files.list, before.files.list);
    });

    it('a stored project without a list: that list is []', () => {
      const old = project();
      delete old.annotations;
      const empty = { ...project(), annotations: { list: [] } };
      assert.deepEqual(keepListsWithoutEditRights(empty, old, viewer), []);
      const grown = project();
      assert.deepEqual(keepListsWithoutEditRights(grown, old, member('annotations', 'edit')), ['annotations']);
      assert.deepEqual(grown.annotations.list, []);
    });
  });
});
