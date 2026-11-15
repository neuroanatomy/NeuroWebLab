const { assert } = require('chai');
const sinon = require('sinon');
const { catchErrors } = require('./index');

// a response that records what was sent, and refuses a second answer as Express does
const fakeRes = () => {
  const res = { headersSent: false, sent: [] };
  res.status = (code) => {
    res.statusCode = code;

    return res;
  };
  const send = (kind) => (body) => {
    if (res.headersSent) {
      throw new Error('Cannot set headers after they are sent to the client');
    }
    res.headersSent = true;
    res.sent.push({ kind, status: res.statusCode, body });

    return res;
  };
  res.json = send('json');
  res.send = send('send');

  return res;
};

const noop = () => null;

const fakeReq = () => ({ log: { error: sinon.spy() }, user: { username: 'alice' } });

describe('util: catchErrors', () => {
  it('passes req, res and next to the handler, and leaves its answer', async () => {
    const req = fakeReq();
    const res = fakeRes();
    const next = sinon.spy();
    const handler = sinon.spy((rq, rs) => rs.status(200).json({ ok: true }));
    await catchErrors(handler)(req, res, next);
    assert.isTrue(handler.calledOnceWithExactly(req, res, next));
    assert.deepEqual(res.sent, [{ kind: 'json', status: 200, body: { ok: true } }]);
    assert.isFalse(req.log.error.called);
  });

  it('a rejected promise gives the error answer once: 500 {error: "Server error"}', async () => {
    const req = fakeReq();
    const res = fakeRes();
    const wrapped = catchErrors(() => Promise.reject(new Error('boom')));
    await wrapped(req, res, noop);
    assert.deepEqual(res.sent, [{ kind: 'json', status: 500, body: { error: 'Server error' } }]);
    assert.isTrue(req.log.error.calledOnce);
    const [logged, message] = req.log.error.firstCall.args;
    assert.equal(logged.err.message, 'boom');
    assert.equal(logged.user, 'alice');
    assert.equal(message, 'unhandled error in route handler');
  });

  it('an error thrown synchronously gives the error answer too', async () => {
    const res = fakeRes();
    await catchErrors(() => {
      throw new TypeError('sync');
    })(fakeReq(), res, noop);
    assert.deepEqual(res.sent, [{ kind: 'json', status: 500, body: { error: 'Server error' } }]);
  });

  it('sends nothing after headers were sent', async () => {
    const req = fakeReq();
    const res = fakeRes();
    const respond = sinon.spy();
    await catchErrors(async (rq, rs) => {
      rs.status(200).send('partial');
      await Promise.resolve();
      throw new Error('after the answer');
    }, respond)(req, res, noop);
    assert.deepEqual(res.sent, [{ kind: 'send', status: 200, body: 'partial' }]);
    assert.isFalse(respond.called);
    assert.isTrue(req.log.error.calledOnce, 'the error is still logged');
  });

  it('sends the error answer given as second argument', async () => {
    const res = fakeRes();
    const respond = sinon.spy((rs) => rs.status(500).send('A page'));
    await catchErrors(() => {
      throw new Error('boom');
    }, respond)(fakeReq(), res, noop);
    assert.isTrue(respond.calledOnceWithExactly(res));
    assert.deepEqual(res.sent, [{ kind: 'send', status: 500, body: 'A page' }]);
  });

  it('logs with console without req.log, and without a user', async () => {
    const stub = sinon.stub(console, 'error');
    const res = fakeRes();
    try {
      await catchErrors(() => Promise.reject(new Error('no logger')))({}, res, noop);
    } finally {
      stub.restore();
    }
    assert.isTrue(stub.calledOnce);
    assert.isUndefined(stub.firstCall.args[0].user);
    assert.equal(res.sent[0].status, 500);
  });
});
