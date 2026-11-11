/**
 * Slice 2 cases: what a save stores. The client's `_id` and `backup` are
 * ignored (2.15); every save is a new version, the old ones `backup: true`
 * (2.16); stored fields the client does not send are kept (2.17); the server
 * sets `modified` and `modifiedBy` (2.18); reads give the current version
 * (2.19); two saves at once both count, one version stays current (2.20).
 */
const { uniform } = require('./matrix');

const SLACK = 2000;

// eslint-disable-next-line max-lines-per-function
module.exports = (t) => {
  const { describe, it, runCase, users, adapter } = t;
  const currents = async (shortname) => (await adapter.versions(shortname)).filter((v) => !v.backup);
  const recent = (date, start) => Date.parse(date) >= start - SLACK;

  describe('versions: client fields, a version per save, stored fields, modified, current reads, two saves at once', function () {
    it('a new project sent with backup: true is stored as the current version (2.15)', runCase('save', async (check) => {
      const shortname = t.track(t.name('clientBackup'));
      const res = await t.save(users.owner, shortname, { ...t.document(shortname), backup: true });
      check('2.15', res.status === 200 && t.exists(await t.json(shortname)), `200 and readable expected, got ${res.status}`);
      check('2.15', (await currents(shortname)).length === 1, 'one current version expected');
    }));

    it('a save sent with an _id and backup: true stores a current version with an id of the server (2.15)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('clientId');
      const id = t.name('clientid');
      const res = await t.save(users.owner, shortname, { ...doc, _id: id, backup: true, name: 'Saved with an id' });
      check('2.15', res.status === 200 && (await t.json(shortname)).name === 'Saved with an id', `200 and readable expected, got ${res.status} ${res.text.slice(0, 80)}`);
      const versions = await adapter.versions(shortname);
      check('2.15', !versions.some((v) => String(v._id) === id), 'a version has the client\'s _id');
      check('2.15', versions.filter((v) => !v.backup).length === 1, 'one current version expected');
    }));

    it('every save stores a new version; the earlier ones are backup: true (2.16)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('versions');
      await t.save(users.owner, shortname, { ...doc, name: 'Second' });
      await t.save(users.owner, shortname, { ...doc, name: 'Third' });
      const versions = await adapter.versions(shortname);
      const seen = versions.map((v) => `${v.name}${v.backup === true ? ' (backup)' : ''}`);
      check('2.16', JSON.stringify(seen) === JSON.stringify([`${doc.name} (backup)`, 'Second (backup)', 'Third']), `3 versions expected, got ${JSON.stringify(seen)}`);
    }));

    it('a save keeps the stored top-level fields it does not send (2.17)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('keepFields', { extra: { description: 'Kept description' } });
      const sent = { ...t.copy(doc), name: 'Saved without a description' };
      delete sent.description;
      const res = await t.save(users.owner, shortname, sent);
      const stored = await t.json(shortname);
      check('2.17', res.status === 200 && stored.name === sent.name && stored.description === 'Kept description', `the description kept expected, got ${res.status} ${JSON.stringify(stored.description)}`);
    }));

    it('creating a project sets modified and modifiedBy (2.18)', runCase('save', async (check) => {
      const start = Date.now();
      const { shortname } = await t.create('modifiedNew');
      const stored = await t.json(shortname);
      check('2.18', recent(stored.modified, start) && stored.modifiedBy === users.owner.username, `modified now and modifiedBy ${users.owner.username} expected, got ${stored.modified} ${stored.modifiedBy}`);
    }));

    it('a save sets modified and modifiedBy, whatever the client sends (2.18)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('modifiedSave');
      const start = Date.now();
      const res = await t.save(users.editor, shortname, { ...doc, modified: '2000-01-01T00:00:00.000Z', modifiedBy: users.owner.username });
      const stored = await t.json(shortname);
      check('2.18', res.status === 200 && recent(stored.modified, start) && stored.modifiedBy === users.editor.username, `modified now and modifiedBy ${users.editor.username} expected, got ${res.status} ${stored.modified} ${stored.modifiedBy}`);
    }));

    it('reads give the current version: JSON, project page, user projects (2.19)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('current', { extra: { name: 'Version one' } });
      await t.save(users.owner, shortname, { ...doc, name: 'Version two' });
      await t.save(users.owner, shortname, { ...doc, name: 'Version three' });
      check('2.19', (await t.json(shortname)).name === 'Version three', 'JSON: the current version expected');
      const page = await t.page(shortname);
      check('2.19', page.status === 200 && !page.text.includes('Version one') && !page.text.includes('Version two'), `the page of the current version expected, got ${page.status}`);
      const times = await t.listed(shortname);
      check('2.19', times === 1, `listed once in the user's projects expected, got ${times}`);
    }));

    it('two saves at once (a file added, a collaborator added) are both kept, one version current (2.20)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('concurrent');
      const withFile = t.copy(doc);
      withFile.files.list.push(t.file(shortname, 'byadder'));
      const withRow = t.copy(doc);
      withRow.collaborators.list.push(t.row(users.outsider.username, uniform('view')));
      const answers = await Promise.all([t.save(users.adder, shortname, withFile), t.save(users.adder2, shortname, withRow)]);
      check('2.20', answers.every((res) => res.status === 200), `200 twice expected, got ${answers.map((res) => res.status)}`);
      const stored = await t.json(shortname);
      const both = t.sources(stored).includes(withFile.files.list[2].source) && Boolean(t.rowOf(stored, users.outsider.username));
      check('2.20', both, `the file and the collaborator expected, got ${t.counts(stored)}`);
      check('2.20', (await currents(shortname)).length === 1, 'one current version expected');
    }));
  });
};
