const { assert } = require('chai');
const sinon = require('sinon');
const { ObjectId } = require('mongodb');
const { sendResult, adminLog } = require('./index');

const fakeRes = () => {
  const res = { sent: [] };
  res.status = (code) => {
    res.statusCode = code;

    return res;
  };
  res.json = (body) => {
    res.sent.push({ status: res.statusCode || 200, body });

    return res;
  };

  return res;
};

// a native Db whose 'log' collection records what is inserted, setting _id
// on the document as the driver does
const fakeDb = ({ setsId = true } = {}) => {
  const inserted = [];
  const names = [];
  const db = {
    inserted,
    names,
    collection: (name) => {
      names.push(name);

      return {
        insertOne: (doc) => {
          const _id = new ObjectId();
          if (setsId) {
            doc._id = _id;
          }
          inserted.push({ ...doc });

          return Promise.resolve({ acknowledged: true, insertedId: _id });
        }
      };
    }
  };

  return db;
};

describe('admin/actions: sendResult', () => {
  it('a result: 200 { success: true, ...result }', async () => {
    const res = fakeRes();
    await sendResult(res, Promise.resolve({ removed: 2, log: 'abc' }));
    assert.deepEqual(res.sent, [{ status: 200, body: { success: true, removed: 2, log: 'abc' } }]);
  });

  it('{status, error}: that status, { success: false, error }', async () => {
    const res = fakeRes();
    await sendResult(res, Promise.resolve({ status: 409, error: 'Changed since' }));
    assert.deepEqual(res.sent, [{ status: 409, body: { success: false, error: 'Changed since' } }]);
  });

  it('a thrown error: 500 \'Server error\', and the logger is called with it', async () => {
    const res = fakeRes();
    const logger = { error: sinon.spy() };
    const err = new Error('db down');
    await sendResult(res, Promise.reject(err), { logger });
    assert.deepEqual(res.sent, [{ status: 500, body: { success: false, error: 'Server error' } }]);
    assert.isTrue(logger.error.calledOnce);
    assert.strictEqual(logger.error.firstCall.args[0].err, err);
    assert.strictEqual(logger.error.firstCall.args[1], 'admin request failed');
  });

  it('without a logger, logs with console.log(\'ERROR:\', err) as BrainBox did', async () => {
    const res = fakeRes();
    const err = new Error('db down');
    const log = sinon.stub(console, 'log');
    try {
      await sendResult(res, Promise.reject(err));
    } finally {
      log.restore();
    }
    assert.strictEqual(res.sent[0].status, 500);
    assert.isTrue(log.calledOnceWithExactly('ERROR:', err));
  });
});

describe('admin/actions: adminLog', () => {
  it('writes { key, value, date } to \'log\' and returns the entry with its _id', async () => {
    const db = fakeDb();
    const value = { username: 'alice', shortname: 'p' };
    const entry = await adminLog(db, 'adminDoSomething', value);
    assert.deepEqual(db.names, ['log']);
    assert.lengthOf(db.inserted, 1);
    assert.instanceOf(entry._id, ObjectId);
    assert.deepEqual(db.inserted[0], entry);
    assert.strictEqual(entry.key, 'adminDoSomething');
    assert.strictEqual(entry.value, value);
    assert.match(entry.date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.deepEqual(Object.keys(entry).sort(), ['_id', 'date', 'key', 'value']);
  });

  it('the _id is the insertedId when the driver does not set it on the entry', async () => {
    const entry = await adminLog(fakeDb({ setsId: false }), 'k', {});
    assert.instanceOf(entry._id, ObjectId);
  });

  it('with a logger, writes the line first, with the caller\'s fields', async () => {
    const db = fakeDb();
    const logger = { info: sinon.spy(() => assert.lengthOf(db.inserted, 0)) };
    const fields = ({ ids, ...rest }) => ({ ...rest, documents: ids.length });
    await adminLog(db, 'adminRemoveOrphans', { username: 'alice', ids: [1, 2, 3] }, { logger, fields });
    assert.isTrue(logger.info.calledOnceWithExactly({ event: 'adminRemoveOrphans', username: 'alice', documents: 3 }, 'admin: adminRemoveOrphans'));
    assert.deepEqual(db.inserted[0].value, { username: 'alice', ids: [1, 2, 3] });
  });

  it('with a logger and no fields, the line has the value', async () => {
    const logger = { info: sinon.spy() };
    await adminLog(fakeDb(), 'k', { a: 1 }, { logger });
    assert.isTrue(logger.info.calledOnceWithExactly({ event: 'k', a: 1 }, 'admin: k'));
  });

  it('no line when no logger is given', async () => {
    const log = sinon.stub(console, 'log');
    const info = sinon.stub(console, 'info');
    try {
      await adminLog(fakeDb(), 'k', { a: 1 }, { fields: (v) => v });
      await adminLog(fakeDb(), 'k', { a: 1 });
    } finally {
      log.restore();
      info.restore();
    }
    assert.isFalse(log.called);
    assert.isFalse(info.called);
  });
});
