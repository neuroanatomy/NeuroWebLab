/**
 * Slice 2 cases: the documents a save accepts and refuses. Shortname (2.6),
 * `anyone` row (2.7), access values (2.8), users (2.9), layers (2.10),
 * sanitising (2.12), the answer to an invalid document (2.13, checked by
 * every refusal here), stored rows and blank rows (2.14).
 */
const { uniform } = require('./matrix');

// eslint-disable-next-line max-lines-per-function
module.exports = (t) => {
  const { describe, it, runCase, users, adapter } = t;

  /* A new project refused under `rule`, and not stored */
  const refusedNew = async (check, rule, shortname, res) => {
    t.invalid(check, rule, res);
    check(rule, !t.exists(await t.json(shortname)), 'the project was stored');
  };
  const newRefused = (key, change, rule) => runCase('save', async (check) => {
    const shortname = t.track(t.name(key));
    const sent = t.document(shortname);
    change(sent);
    await refusedNew(check, rule, shortname, await t.save(users.owner, shortname, sent));
  });

  // eslint-disable-next-line max-statements -- one statement per case
  describe('validation: shortname, anyone, access values, users, layers, sanitising, stored and blank rows', function () {
    it('a new project whose shortname differs from the URL is refused; neither is stored (2.6)', runCase('save', async (check) => {
      const url = t.track(t.name('urlName'));
      const body = t.track(t.name('bodyName'));
      const res = await t.save(users.owner, url, t.document(body));
      await refusedNew(check, '2.6', url, res);
      check('2.6', !t.exists(await t.json(body)), 'the project named in the body was stored');
    }));

    it('a stored project saved with another shortname in the body is refused; it is unchanged, the other not stored (2.6)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('renamed');
      const other = t.track(t.name('renamedTo'));
      const res = await t.save(users.owner, shortname, { ...t.document(other), name: 'Saved under another name' });
      await refusedNew(check, '2.6', other, res);
      check('2.6', (await t.json(shortname)).name === doc.name, 'the stored project changed');
    }));

    it('a new shortname with a hyphen is accepted (2.6)', runCase('save', async (check) => {
      const shortname = t.track(t.name('with-hyphen'));
      const res = await t.save(users.owner, shortname, t.document(shortname));
      check('2.6', res.status === 200 && t.exists(await t.json(shortname)), `200 and stored expected, got ${res.status} ${res.text.slice(0, 80)}`);
    }));

    it('a new shortname with another character than [a-zA-Z0-9-] is refused (2.6)', newRefused('with_underscore', () => null, '2.6'));

    it('a new project without an anyone row is refused (2.7)', runCase('save', async (check) => {
      const shortname = t.track(t.name('noAnyone'));
      await refusedNew(check, '2.7', shortname, await t.save(users.owner, shortname, t.document(shortname, { anyone: null })));
    }));

    it('an access value that only contains a valid one ("viewer") is refused (2.8)', newRefused('viewer', (doc) => {
      t.rowOf(doc, users.viewer.username).access.files = 'viewer';
    }, '2.8'));

    it('a new project with a collaborator who does not exist is refused (2.9)', newRefused('nobody', (doc) => {
      doc.collaborators.list.push(t.row(t.name('nobody'), uniform('view')));
    }, '2.9'));

    it('a collaborator who does not exist, added to a stored project, is refused; nothing changes (2.9)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('addNobody');
      const sent = t.copy(doc);
      sent.collaborators.list.push(t.row(t.name('nobody'), uniform('view')));
      t.invalid(check, '2.9', await t.save(users.owner, shortname, sent));
      check('2.9', t.counts(await t.json(shortname)) === t.counts(doc), 'the stored project changed');
    }));

    it('a stored row of a user removed since does not block a save (2.9)', runCase('save', async (check) => {
      if (!adapter.removesUsers) {
        throw new Error('adapter.removeUser is needed: 2.9 removes a user who is a collaborator');
      }
      const { shortname, doc } = await t.create('goneUser', { rows: { ...t.ROWS, gone: uniform('view') } });
      await adapter.removeUser(users.gone.username);
      const res = await t.save(users.owner, shortname, { ...doc, name: 'Saved after a user left' });
      check('2.9', res.status === 200 && (await t.json(shortname)).name === 'Saved after a user left', `200 and the save stored expected, got ${res.status} ${res.text.slice(0, 120)}`);
    }));

    it('a layer of a type the app does not have is refused (2.10)', newRefused('layerType', (doc) => {
      doc.annotations.list.push(t.layer('Other', { type: 'nosuchtype' }));
    }, '2.10'));

    it('a layer without a name is refused (2.10)', newRefused('layerNoName', (doc) => {
      doc.annotations.list.push(t.layer(''));
    }, '2.10'));

    it('two layers with the same name, ignoring case and spaces, are refused (2.10)', newRefused('layerTwice', (doc) => {
      doc.annotations.list.push(t.layer(' layer '));
    }, '2.10'));

    it('strings are sanitised one by one, as text: markup removed, the text and "&" kept (2.12)', runCase('save', async (check) => {
      const shortname = t.track(t.name('sanitise'));
      const sent = t.document(shortname);
      sent.annotations.list[0].name = 'Marked <img src=x onerror=alert(1)> up';
      sent.annotations.list.push(t.layer('R&D "quoted"'));
      const res = await t.save(users.owner, shortname, sent);
      const [marked, quoted] = t.layerNames(await t.json(shortname));
      check('2.12', res.status === 200, `200 expected, got ${res.status} ${res.text.slice(0, 80)}`);
      check('2.12', typeof marked === 'string' && !marked.includes('<') && marked.startsWith('Marked') && marked.endsWith('up'), `the markup removed and the text kept expected, got ${JSON.stringify(marked)}`);
      check('2.12', quoted === 'R&D "quoted"', `R&D "quoted" kept expected, got ${JSON.stringify(quoted)}`);
    }));

    it('a document that is not a project, or none, is answered 400 {error} (2.13)', runCase('save', async (check) => {
      const shortname = t.track(t.name('notAProject'));
      await refusedNew(check, '2.13', shortname, await t.save(users.owner, shortname, 'not a project'));
      await refusedNew(check, '2.13', shortname, await t.post(users.owner, shortname, {}));
    }));

    it('stored rows are accepted as they are (a layer without a name, two layers named alike) (2.14)', runCase('save', async (check) => {
      const shortname = t.track(t.name('storedRows'));
      const doc = t.document(shortname);
      doc.annotations.list.push(t.layer(''), t.layer('layer'));
      await adapter.insertProject(t.copy(doc));
      const res = await t.save(users.owner, shortname, { ...doc, name: 'Saved with its stored rows' });
      const stored = await t.json(shortname);
      check('2.14', res.status === 200 && stored.name === 'Saved with its stored rows' && t.layerNames(stored).length === 3, `200 and the save stored expected, got ${res.status} ${res.text.slice(0, 120)}`);
    }));

    it('blank new rows (file, collaborator, layer) are dropped, the save stored (2.14)', runCase('save', async (check) => {
      const { shortname, doc } = await t.create('blankRows');
      const sent = { ...t.copy(doc), name: 'Saved with blank rows' };
      sent.files.list.push({ source: '', name: '' });
      sent.collaborators.list.push({ userID: '', username: '', access: uniform('none') });
      sent.annotations.list.push({ ...t.layer(''), values: '' });
      const res = await t.save(users.owner, shortname, sent);
      const stored = await t.json(shortname);
      check('2.14', res.status === 200 && stored.name === sent.name && t.counts(stored) === t.counts(doc), `200, the save stored and ${t.counts(doc)} rows expected, got ${res.status} ${t.counts(stored)} ${res.text.slice(0, 80)}`);
    }));
  });
};
