const { assert } = require('chai');
const _ = require('lodash');
const {
  plainText,
  sanitize,
  isBlank,
  text,
  listOf,
  isBlankRow,
  sortRows,
  shortnamePattern,
  droppedMessage
} = require('./rules');

// the apps' rowKey, which stay in each app (M3): microdraw project.validation.js (withBothKeys
// simplified), BrainBox project-rows.js
const asFileObject = (f) => {
  if (typeof f !== 'string') {
    return f;
  }
  const at = f.lastIndexOf('/');

  return { source: f, name: at > 0 ? f.substring(at + 1) : '' };
};
const microdrawRowKey = {
  files: (f) => {
    const o = asFileObject(f);

    return _.isPlainObject(o) ? { source: text(o.source), name: text(o.name) } : o;
  },
  collaborators: (c) => (_.isPlainObject(c) ? { username: text(c.username || c.userID), userID: text(c.userID || c.username), access: c.access } : c),
  annotations: (a) => (_.isPlainObject(a) ? { type: a.type, name: text(a.name), values: text(a.values) } : a)
};
const fileSource = (f) => (_.isPlainObject(f) ? f.source : f);
const collaboratorUser = (c) => (_.isPlainObject(c) ? (c.userID || c.nickname || c.username) : c);
const brainboxRowKey = {
  files: (f) => text(fileSource(f)),
  collaborators: (c) => (_.isPlainObject(c) ?
    { user: text(collaboratorUser(c)), access: _.isPlainObject(c.access) ? _.pick(c.access, ['collaborators', 'files', 'annotations']) : c.access } :
    c),
  annotations: (a) => (_.isPlainObject(a) ? { type: a.type, name: text(a.name), values: text(a.values) } : a)
};

// a value that is not set (the lint refuses the `undefined` literal)
const absent = {}.none;
const access = (level) => ({ files: level, annotations: level, collaborators: level });

describe('project/rules.js: validation helpers (1.10.0)', () => {
  describe('plainText', () => {
    // microdraw test/api/project-validation.spec.js "sanitising"
    it('removes markup and keeps text, "&" and "a < b"', () => {
      assert.equal(plainText('<img src=x onerror=alert(1)>Name'), 'Name');
      assert.equal(plainText('<script>alert(1)</script>ok'), 'ok');
      assert.equal(plainText('<b>bold</b>'), 'bold');
      assert.equal(plainText('a < b'), 'a < b');
      assert.equal(plainText('x?a=1&b=2'), 'x?a=1&b=2');
    });

    it('decodes entities and drops comments, links and mXSS payloads', () => {
      assert.equal(plainText('<b>x</b>&amp;y'), 'x&y');
      assert.equal(plainText('<!-- c -->k'), 'k');
      assert.equal(plainText('<a href="javascript:alert(1)">l</a>'), 'l');
      assert.equal(plainText('<noscript><p title="</noscript><img src=x onerror=alert(1)>">'), '');
      assert.equal(plainText('<math><mi><mglyph><style><img src=x onerror=alert(1)>'), '');
    });

    it('removes a <script> element with its content', () => {
      assert.equal(plainText('a<script>document.cookie</script>b'), 'ab');
      assert.notInclude(plainText('<script src="https://example.org/x.js"></script>'), 'script');
    });

    it('removes an element with an onerror attribute, keeping the text around it', () => {
      assert.equal(plainText('before <img src="x" onerror="alert(1)"> after'), 'before  after');
      assert.equal(plainText('<span onerror="alert(1)">kept</span>'), 'kept');
    });

    it('keeps a string without "<" as it is, entities included', () => {
      assert.equal(plainText('Tom &amp; Jerry'), 'Tom &amp; Jerry');
      assert.equal(plainText('&lt;b&gt;'), '&lt;b&gt;');
    });

    it('decodes entities once the string has markup', () => {
      assert.equal(plainText('<i>Tom</i> &amp; Jerry &lt;3'), 'Tom & Jerry <3');
    });

    it('keeps plain text unchanged', () => {
      for (const str of ['', 'plain text', 'Área 17 – V1', 'https://example.org/a.png?x=1&y=2', '   ']) {
        assert.strictEqual(plainText(str), str);
      }
    });
  });

  describe('sanitize', () => {
    it('sanitises every string of nested objects and arrays', () => {
      const value = {
        name: '<b>Project</b>',
        files: { list: [{ source: 'a.png', name: '<img src=x onerror=alert(1)>a' }] },
        tags: ['<i>one</i>', ['<u>two</u>', 3]],
        deep: { deeper: { deepest: '<script>x</script>y' } }
      };
      assert.deepEqual(sanitize(value), {
        name: 'Project',
        files: { list: [{ source: 'a.png', name: 'a' }] },
        tags: ['one', ['two', 3]],
        deep: { deeper: { deepest: 'y' } }
      });
    });

    it('returns a copy and leaves the value it was given unchanged', () => {
      const value = { list: [{ name: '<b>x</b>' }] };
      const copy = sanitize(value);
      assert.notStrictEqual(copy, value);
      assert.notStrictEqual(copy.list, value.list);
      assert.equal(value.list[0].name, '<b>x</b>');
    });

    it('returns a non-string, null and undefined as they are', () => {
      assert.strictEqual(sanitize(null), null);
      assert.strictEqual(sanitize(absent), absent);
      assert.strictEqual(sanitize(42), 42);
      assert.strictEqual(sanitize(true), true);
      assert.deepEqual(sanitize({ a: null, b: 0, c: false }), { a: null, b: 0, c: false });
    });

    it('returns an object that is not a plain object as it is', () => {
      const date = new Date(0); assert.strictEqual(sanitize(date), date);
    });
  });

  describe('isBlank and text', () => {
    it('isBlank: null, undefined and strings of spaces only', () => {
      for (const v of [null, absent, '', '   ', '\t\n']) {
        assert.isTrue(isBlank(v), JSON.stringify(v));
      }
      for (const v of ['a', ' a ', 0, false, [], {}]) {
        assert.isFalse(isBlank(v), JSON.stringify(v));
      }
    });

    it('text: blank values become \'\', others are kept', () => {
      assert.strictEqual(text(null), '');
      assert.strictEqual(text(absent), '');
      assert.strictEqual(text('  '), '');
      assert.strictEqual(text('a'), 'a');
      assert.strictEqual(text(0), 0);
    });
  });

  describe('listOf', () => {
    it('gives project[type].list, or [] when there is none', () => {
      const list = [{ source: 'a' }];
      assert.strictEqual(listOf({ files: { list } }, 'files'), list);
      assert.deepEqual(listOf({ files: { list } }, 'annotations'), []);
      assert.deepEqual(listOf({ files: { list: 'a' } }, 'files'), []);
      assert.deepEqual(listOf({ files: [] }, 'files'), []);
      assert.deepEqual(listOf(null, 'files'), []);
      assert.deepEqual(listOf(absent, 'files'), []);
    });
  });

  describe('isBlankRow', () => {
    it('files: a row without source and name', () => {
      assert.isTrue(isBlankRow.files({}));
      assert.isTrue(isBlankRow.files({ source: '', name: ' ' }));
      assert.isTrue(isBlankRow.files({ source: null, name: null }));
      assert.isFalse(isBlankRow.files({ source: 'a.png', name: '' }));
      assert.isFalse(isBlankRow.files({ source: '', name: 'a' }));
      assert.isFalse(isBlankRow.files(''), 'a string file is not a blank row');
    });

    it('collaborators: a row that names no user by username, userID or nickname', () => {
      assert.isTrue(isBlankRow.collaborators({ username: '', userID: '', access: access('view') }));
      assert.isTrue(isBlankRow.collaborators({ access: access('view') }));
      assert.isFalse(isBlankRow.collaborators({ username: 'u', access: access('view') }));
      assert.isFalse(isBlankRow.collaborators({ userID: 'u', access: access('view') }));
      assert.isFalse(isBlankRow.collaborators({ nickname: 'u', access: access('view') }));
      assert.isFalse(isBlankRow.collaborators(null));
    });

    it('annotations: a layer without name and values', () => {
      assert.isTrue(isBlankRow.annotations({ type: 'text', name: '', values: '' }));
      assert.isTrue(isBlankRow.annotations({ type: 'vectorial' }));
      assert.isFalse(isBlankRow.annotations({ type: 'text', name: 'Notes' }));
      assert.isFalse(isBlankRow.annotations({ type: 'text', name: '', values: 'a' }));
      assert.isFalse(isBlankRow.annotations('text'));
    });
  });

  describe('sortRows', () => {
    it('needs the app\'s rowKey', () => {
      assert.throws(() => sortRows('files', [], []), /rowKey/);
      assert.throws(() => sortRows('files', [], [], { rowKey: {} }), /rowKey\.files/);
    });
    it('a stored row is kept as stored wherever it is; a blank new row is dropped; others are kept', () => {
      const oldRows = [{ type: 'text', name: '', values: '' }, { type: 'text', name: 'A' }];
      const rows = [
        { type: 'text', name: 'A' },
        { type: 'text', name: 'B' },
        { type: 'text', name: '', values: null },
        { type: 'text', name: ' ', values: '' }
      ];
      const { kept, stored, dropped } = sortRows('annotations', rows, oldRows, { rowKey: microdrawRowKey });
      // the first blank row matches the stored blank row; the second is new and blank
      assert.deepEqual(kept, rows.slice(0, 3));
      assert.deepEqual([...stored].sort(), [0, 2]);
      assert.equal(dropped, 1);
    });

    it('each stored row matches at most one row sent', () => {
      const oldRows = [{ source: 'a.png', name: 'a.png' }];
      const rows = [{ source: 'a.png', name: 'a.png' }, { source: 'a.png', name: 'a.png' }];
      const { kept, stored, dropped } = sortRows('files', rows, oldRows, { rowKey: microdrawRowKey });
      assert.equal(kept.length, 2);
      assert.deepEqual([...stored], [0]);
      assert.equal(dropped, 0);
    });

    it('microdraw\'s shapes: a stored string file and a one-key collaborator match the rows the settings page sends', () => {
      const oldRows = { files: ['data/a.png'], collaborators: [{ username: 'u', access: access('view') }] };
      const rows = {
        files: [{ source: 'data/a.png', name: 'a.png' }],
        collaborators: [{ username: 'u', userID: 'u', access: access('view') }]
      };
      for (const type of ['files', 'collaborators']) {
        const { stored } = sortRows(type, rows[type], oldRows[type], { rowKey: microdrawRowKey });
        assert.deepEqual([...stored], [0], type);
      }
    });

    it('BrainBox\'s shapes: a file stored as its source and a collaborator named by userID or nickname', () => {
      const oldRows = {
        files: ['https://example.org/a.nii.gz'],
        collaborators: [{ userID: 'u', access: access('view') }, { nickname: 'v', access: access('edit') }]
      };
      const rows = {
        files: [{ source: 'https://example.org/a.nii.gz', name: 'a' }],
        collaborators: [{ nickname: 'v', access: access('edit') }, { userID: 'u', name: 'U', access: access('view') }]
      };
      assert.deepEqual([...sortRows('files', rows.files, oldRows.files, { rowKey: brainboxRowKey }).stored], [0]);
      assert.deepEqual([...sortRows('collaborators', rows.collaborators, oldRows.collaborators, { rowKey: brainboxRowKey }).stored], [0, 1]);
    });

    it('compares the stored rows as given: the caller sanitises them as the rows sent', () => {
      const oldRows = [{ type: 'text', name: '<b>A</b>' }];
      const rows = [{ type: 'text', name: 'A' }];
      assert.equal(sortRows('annotations', rows, oldRows, { rowKey: microdrawRowKey }).stored.size, 0);
      assert.equal(sortRows('annotations', rows, oldRows.map(sanitize), { rowKey: microdrawRowKey }).stored.size, 1);
    });

    it('takes the app\'s isBlankRow', () => {
      const rows = [{ nickname: 'v', access: access('view') }];
      // by default a row named by nickname is not blank (BrainBox's)
      assert.equal(sortRows('collaborators', rows, [], { rowKey: microdrawRowKey }).dropped, 0);
      // microdraw's isBlankRow did not read nickname
      const microdrawBlank = { ...isBlankRow, collaborators: (c) => _.isPlainObject(c) && isBlank(c.username) && isBlank(c.userID) };
      const { kept, dropped } = sortRows('collaborators', rows, [], { rowKey: microdrawRowKey, isBlankRow: microdrawBlank });
      assert.deepEqual(kept, []);
      assert.equal(dropped, 1);
    });

    it('leaves the rows it was given unchanged', () => {
      const rows = [{ source: '', name: '' }, { source: 'b.png', name: 'b' }];
      const before = _.cloneDeep(rows);
      sortRows('files', rows, [], { rowKey: microdrawRowKey });
      assert.deepEqual(rows, before);
    });
  });

  describe('shortnamePattern', () => {
    // BrainBox test/unit/project-shortname.spec.js, but '' (the page's check accepts it while
    // typing; the server's expression needs one character)
    it('accepts letters, numbers and hyphens', () => {
      for (const name of ['abc', 'ABC123', 'my-project', '-', 'a-b-c-1', '0']) {
        assert.isTrue(shortnamePattern.test(name), name);
      }
    });

    it('refuses any other character, and the empty name', () => {
      for (const name of ['', 'my_project', 'my project', 'a.b', 'é', 'a/b', '<b>', 'a\nb', 'abc\n']) {
        assert.isFalse(shortnamePattern.test(name), JSON.stringify(name));
      }
    });
  });

  describe('droppedMessage', () => {
    it('is \'\' when no row was dropped', () => {
      assert.strictEqual(droppedMessage({}), '');
      assert.strictEqual(droppedMessage({ files: 0, annotations: 0 }), '');
      assert.strictEqual(droppedMessage(absent), '');
    });

    it('names one list, with its leading space', () => {
      assert.strictEqual(droppedMessage({ files: 0, annotations: 2 }), ' Empty rows were not saved (2 annotations).');
    });

    it('names several lists, in their order', () => {
      assert.strictEqual(droppedMessage({ files: 1, collaborators: 0, annotations: 3 }), ' Empty rows were not saved (1 files, 3 annotations).');
    });
  });
});
