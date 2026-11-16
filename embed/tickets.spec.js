const { assert } = require('chai');
const sinon = require('sinon');
const { MongoClient } = require('mongodb');
const { toMongoUri } = require('../db/native');
const {
  WS_TICKET_COLLECTION,
  WS_TICKET_DURATION,
  mintWsTicket,
  findWsTicket,
  ensureTicketIndex
} = require('./index');

const mongoDbPath = process.env.MONGODB_TEST;
if (!mongoDbPath) {
  throw new Error('MONGODB_TEST must be explicitly set to avoid overwriting production');
}

describe('embed/tickets', () => {
  let client;
  let db;

  const dropTickets = async () => {
    const names = (await db.listCollections({ name: WS_TICKET_COLLECTION }).toArray()).map((c) => c.name);
    if (names.length) {
      await db.collection(WS_TICKET_COLLECTION).drop();
    }
  };

  before(async () => {
    client = new MongoClient(toMongoUri(mongoDbPath));
    await client.connect();
    db = client.db();
  });

  beforeEach(dropTickets);

  after(async () => {
    await dropTickets();
    await client.close();
  });

  it('the collection and lifetime are both apps\': embedWsTicket, 6 h', () => {
    assert.strictEqual(WS_TICKET_COLLECTION, 'embedWsTicket');
    assert.strictEqual(WS_TICKET_DURATION, 6 * 3600 * 1000);
  });

  describe('mintWsTicket', () => {
    it('stores BrainBox\'s scope unchanged, with a 6 h lifetime', async () => {
      const before = Date.now();
      const token = await mintWsTicket(db, { dirname: '/data/abc', mriSource: 'https://x.org/a.nii.gz', username: 'ana' });
      assert.match(token, /^[0-9a-f]{48}$/);
      const ticket = await db.collection(WS_TICKET_COLLECTION).findOne({ token }, { projection: { _id: 0 } });
      assert.sameMembers(Object.keys(ticket), ['token', 'dirname', 'mriSource', 'username', 'createdAt', 'expiryDate']);
      assert.strictEqual(ticket.dirname, '/data/abc');
      assert.strictEqual(ticket.mriSource, 'https://x.org/a.nii.gz');
      assert.strictEqual(ticket.username, 'ana');
      assert.instanceOf(ticket.createdAt, Date);
      assert.isAtLeast(ticket.createdAt.getTime(), before - 1000);
      assert.strictEqual(ticket.expiryDate.getTime() - ticket.createdAt.getTime(), WS_TICKET_DURATION);
    });

    it('stores microdraw\'s scope unchanged (a null project stays null, none is added)', async () => {
      const token = await mintWsTicket(db, { source: 'https://x.org/d.json', project: null, username: 'bo' });
      const ticket = await db.collection(WS_TICKET_COLLECTION).findOne({ token }, { projection: { _id: 0 } });
      assert.sameMembers(Object.keys(ticket), ['token', 'source', 'project', 'username', 'createdAt', 'expiryDate']);
      assert.strictEqual(ticket.source, 'https://x.org/d.json');
      assert.isNull(ticket.project);

      // no normalisation: an empty project is stored as given
      const token2 = await mintWsTicket(db, { source: 's', project: '' });
      const ticket2 = await db.collection(WS_TICKET_COLLECTION).findOne({ token: token2 });
      assert.strictEqual(ticket2.project, '');
    });

    it('sets username to null when the scope doesn\'t give one', async () => {
      const token = await mintWsTicket(db, { source: 's', project: 'p' });
      const ticket = await db.collection(WS_TICKET_COLLECTION).findOne({ token });
      assert.property(ticket, 'username');
      assert.isNull(ticket.username);
    });

    it('gives a new token each time', async () => {
      const a = await mintWsTicket(db, { source: 's' });
      const b = await mintWsTicket(db, { source: 's' });
      assert.notStrictEqual(a, b);
    });
  });

  describe('findWsTicket', () => {
    it('finds a valid ticket', async () => {
      const token = await mintWsTicket(db, { source: 's', project: 'p', username: 'ana' });
      const ticket = await findWsTicket(db, token);
      assert.strictEqual(ticket.token, token);
      assert.strictEqual(ticket.source, 's');
      assert.strictEqual(ticket.project, 'p');
      assert.strictEqual(ticket.username, 'ana');
    });

    it('refuses a missing, empty or non-string token without a lookup', async () => {
      const fake = { collection: sinon.stub().throws(new Error('no lookup expected')) };
      for (const token of [{}.missing, null, '', 42, true, { $ne: null }, ['x']]) {
        // eslint-disable-next-line no-await-in-loop
        assert.isNull(await findWsTicket(fake, token), String(token));
      }
      assert.isFalse(fake.collection.called);
    });

    it('refuses an unknown token', async () => {
      assert.isNull(await findWsTicket(db, 'f'.repeat(48)));
    });

    it('refuses an expired ticket', async () => {
      const token = await mintWsTicket(db, { source: 's' });
      await db.collection(WS_TICKET_COLLECTION).updateOne({ token }, { $set: { expiryDate: new Date(Date.now() - 1000) } });
      assert.isNull(await findWsTicket(db, token));
    });

    it('refuses a ticket without a Date expiry', async () => {
      await db.collection(WS_TICKET_COLLECTION).insertMany([
        { token: 'noexpiry', source: 's' },
        { token: 'stringexpiry', source: 's', expiryDate: new Date(Date.now() + 60000).toISOString() },
        { token: 'numberexpiry', source: 's', expiryDate: Date.now() + 60000 }
      ]);
      for (const token of ['noexpiry', 'stringexpiry', 'numberexpiry']) {
        // eslint-disable-next-line no-await-in-loop
        assert.isNull(await findWsTicket(db, token), token);
      }
    });
  });

  describe('ensureTicketIndex', () => {
    const ticketIndexes = async () => {
      const indexes = await db.collection(WS_TICKET_COLLECTION).indexes();

      return Object.fromEntries(indexes.map((i) => [i.name, i]));
    };

    it('creates both indexes with microdraw\'s names and the TTL option, and runs again without error', async () => {
      const logger = { warn: sinon.spy() };
      await ensureTicketIndex(db, { logger });
      let indexes = await ticketIndexes();
      assert.deepEqual(indexes.token_1.key, { token: 1 });
      assert.notProperty(indexes.token_1, 'expireAfterSeconds');
      assert.deepEqual(indexes.expiryDate_1.key, { expiryDate: 1 });
      assert.strictEqual(indexes.expiryDate_1.expireAfterSeconds, 0);

      await ensureTicketIndex(db, { logger });
      indexes = await ticketIndexes();
      assert.sameMembers(Object.keys(indexes), ['_id_', 'token_1', 'expiryDate_1']);
      assert.isFalse(logger.warn.called);
    });

    it('is a no-op on indexes made as microdraw makes them', async () => {
      // microdraw's app/controller/indexes.js: createIndex(keys, { ...options, name })
      await db.collection(WS_TICKET_COLLECTION).createIndex({ token: 1 }, { name: 'token_1' });
      await db.collection(WS_TICKET_COLLECTION).createIndex({ expiryDate: 1 }, { expireAfterSeconds: 0, name: 'expiryDate_1' });
      const logger = { warn: sinon.spy() };
      await ensureTicketIndex(db, { logger });
      assert.isFalse(logger.warn.called);
      assert.sameMembers(Object.keys(await ticketIndexes()), ['_id_', 'token_1', 'expiryDate_1']);
    });

    it('doesn\'t reject when createIndex fails: a warning per index', async () => {
      const err = new Error('not allowed');
      const createIndex = sinon.stub().rejects(err);
      const fake = { collection: sinon.stub().returns({ createIndex }) };
      const logger = { warn: sinon.spy() };
      await ensureTicketIndex(fake, { logger });
      assert.strictEqual(createIndex.callCount, 2);
      assert.strictEqual(logger.warn.callCount, 2);
      assert.deepEqual(logger.warn.firstCall.args[0], { err, index: 'token_1' });
      assert.deepEqual(logger.warn.secondCall.args[0], { err, index: 'expiryDate_1' });
      assert.deepEqual(fake.collection.firstCall.args, ['embedWsTicket']);
    });

    it('warns through console by default', async () => {
      const fake = { collection: () => ({ createIndex: () => Promise.reject(new Error('x')) }) };
      const warn = sinon.stub(console, 'warn');
      try {
        await ensureTicketIndex(fake);
      } finally {
        warn.restore();
      }
      assert.strictEqual(warn.callCount, 2);
    });
  });
});
