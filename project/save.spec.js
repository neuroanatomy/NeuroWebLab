const { assert } = require('chai');
const Configuration = require('../Configuration');
const {
  canSaveProject,
  keepFieldsWithoutFilesEdit,
  saveRefusal,
  ignoredChangesMessage,
  filesListIncomplete
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
});
