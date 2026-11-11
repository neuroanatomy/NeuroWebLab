/**
 * Slice 2 cases: saving needs a login (2.1) and `files: edit` on the stored
 * version (2.2); lists grow with `add`, shrink with `remove` (2.3); rows
 * change in place with `edit` (2.4); the owner is never the client's (2.5).
 */
const { uniform } = require('./matrix');

const level = (t, project, username, type) => ((t.rowOf(project, username) || {}).access || {})[type];

// eslint-disable-next-line max-lines-per-function
module.exports = (t) => {
  const { describe, it, runCase, users, R } = t;

  describe('save: login, edit rights, list lengths, rows in place, owner', function () {
    it(`anonymous: POST ${R.save} of a new project is refused, 401, nothing stored (2.1)`, runCase('save', async (check) => {
      const shortname = t.track(t.name('anonymous'));
      const res = await t.save(null, shortname, t.document(shortname));
      check('2.1', [401, 403].includes(res.status), `refused expected, got ${res.status}`);
      if ([401, 403].includes(res.status)) {
        check('2.1/status', res.status === 401, `401 expected, got ${res.status}`);
      }
      check('2.1', !t.exists(await t.json(shortname)), 'the project was stored');
    }));

    it('collaborator with files view: a save is refused 403, also when the document gives them files edit; nothing changes (2.2)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('viewerSave');
      const sent = t.copy(doc);
      sent.name = 'Changed by a viewer';
      t.rowOf(sent, users.viewer.username).access.files = 'edit';
      const res = await t.save(users.viewer, shortname, sent);
      check('2.2', res.status === 403, `403 expected, got ${res.status}`);
      const stored = await t.json(shortname);
      check('2.2', stored.name === doc.name && level(t, stored, users.viewer.username, 'files') === 'view', `the stored project changed: ${stored.name}, files ${level(t, stored, users.viewer.username, 'files')}`);
    }));

    it('collaborator with edit: a collaborator, a file and a layer added are ignored: 200, "ignored", the stored lists kept (2.3)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('editorGrow');
      const sent = t.copy(doc);
      sent.collaborators.list.push(t.row(users.outsider.username, uniform('view')));
      sent.files.list.push(t.file(shortname, 'added'));
      sent.annotations.list.push(t.layer('Added layer'));
      const res = await t.save(users.editor, shortname, sent);
      check('2.3', res.status === 200 && (/ignored/i).test(t.message(res)), `200 and a message saying "ignored" expected, got ${res.status} ${res.text.slice(0, 120)}`);
      const stored = await t.json(shortname);
      check('2.3', t.counts(stored) === t.counts(doc), `stored lists ${t.counts(doc)} expected, got ${t.counts(stored)}`);
    }));

    it('collaborator with edit: a collaborator and a file removed are ignored: 200, "ignored", the stored lists kept (2.3)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('editorShrink');
      const sent = t.copy(doc);
      sent.collaborators.list = sent.collaborators.list.filter((c) => c !== t.rowOf(sent, users.viewer.username));
      sent.files.list.pop();
      const res = await t.save(users.editor, shortname, sent);
      check('2.3', res.status === 200 && (/ignored/i).test(t.message(res)), `200 and a message saying "ignored" expected, got ${res.status} ${res.text.slice(0, 120)}`);
      const stored = await t.json(shortname);
      check('2.3', t.counts(stored) === t.counts(doc), `stored lists ${t.counts(doc)} expected, got ${t.counts(stored)}`);
    }));

    it('collaborator with add: rows added are stored; removing them again is ignored (2.3)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('adderGrow');
      const grown = t.copy(doc);
      grown.collaborators.list.push(t.row(users.outsider.username, uniform('view')));
      grown.files.list.push(t.file(shortname, 'added'));
      grown.annotations.list.push(t.layer('Added layer'));
      const res = await t.save(users.adder, shortname, grown);
      check('2.3', res.status === 200 && t.counts(await t.json(shortname)) === t.counts(grown), `200 and ${t.counts(grown)} stored expected, got ${res.status}`);
      const back = await t.save(users.adder, shortname, doc);
      const stored = await t.json(shortname);
      check('2.3', back.status === 200 && (/ignored/i).test(t.message(back)) && t.counts(stored) === t.counts(grown), `removal ignored expected, got ${back.status}, ${t.counts(stored)} stored`);
    }));

    it('owner: a collaborator and a file removed are removed (2.3)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('ownerShrink');
      const sent = t.copy(doc);
      sent.collaborators.list = sent.collaborators.list.filter((c) => c !== t.rowOf(sent, users.viewer.username));
      sent.files.list.pop();
      const res = await t.save(users.owner, shortname, sent);
      const stored = await t.json(shortname);
      check('2.3', res.status === 200 && t.counts(stored) === t.counts(sent), `200 and ${t.counts(sent)} stored expected, got ${res.status}, ${t.counts(stored)}`);
    }));

    it('collaborator with files edit, collaborators and annotations view: their row and the layer changed in place are kept as stored, the file changed is stored (2.4)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('inPlace');
      const sent = t.copy(doc);
      t.rowOf(sent, users.filesEditor.username).access.collaborators = 'remove';
      sent.annotations.list[0].name = 'Renamed layer';
      sent.files.list[0] = t.file(shortname, 'replaced');
      const res = await t.save(users.filesEditor, shortname, sent);
      check('2.4', res.status === 200, `200 expected, got ${res.status} ${res.text.slice(0, 80)}`);
      const stored = await t.json(shortname);
      check('2.4', level(t, stored, users.filesEditor.username, 'collaborators') === 'view', `their row kept expected, got collaborators ${level(t, stored, users.filesEditor.username, 'collaborators')}`);
      check('2.4', t.layerNames(stored)[0] === 'Layer', `the layer kept expected, got ${JSON.stringify(t.layerNames(stored))}`);
      check('2.4', t.sources(stored).includes(sent.files.list[0].source), 'the file changed is not stored');
    }));

    it('collaborator with edit: a row and a layer changed in place are stored (2.4)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('inPlaceEdit');
      const sent = t.copy(doc);
      t.rowOf(sent, users.viewer.username).access.files = 'edit';
      sent.annotations.list[0].name = 'Renamed layer';
      const res = await t.save(users.editor, shortname, sent);
      const stored = await t.json(shortname);
      check('2.4', res.status === 200 && level(t, stored, users.viewer.username, 'files') === 'edit' && t.layerNames(stored)[0] === 'Renamed layer', `200 and the changes stored expected, got ${res.status}, ${JSON.stringify(t.layerNames(stored))}`);
    }));

    it('a new project naming another user as owner belongs to its creator (2.5)', runCase('save', async (check) => {
      const shortname = t.track(t.name('ownerOther'));
      const res = await t.save(users.owner, shortname, { ...t.document(shortname), owner: users.outsider.username });
      const stored = await t.json(shortname);
      check('2.5', res.status === 200 && (stored || {}).owner === users.owner.username, `200 and owner ${users.owner.username} expected, got ${res.status}, owner ${(stored || {}).owner}`);
    }));

    it('a new project without an owner belongs to its creator (2.5)', runCase('save', async (check) => {
      const shortname = t.track(t.name('ownerNone'));
      const sent = t.document(shortname);
      delete sent.owner;
      const res = await t.save(users.owner, shortname, sent);
      const stored = await t.json(shortname);
      check('2.5', res.status === 200 && (stored || {}).owner === users.owner.username, `200 and owner ${users.owner.username} expected, got ${res.status} ${res.text.slice(0, 80)}`);
    }));

    it('collaborator with edit: a save naming them owner keeps the stored owner (2.5)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('ownerTaken');
      const res = await t.save(users.editor, shortname, { ...doc, owner: users.editor.username });
      const stored = await t.json(shortname);
      check('2.5', res.status === 200 && (stored || {}).owner === users.owner.username, `200 and owner ${users.owner.username} expected, got ${res.status}, owner ${(stored || {}).owner}`);
    }));
  });
};
