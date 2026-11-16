const { assert } = require('chai');
const sinon = require('sinon');
const { projectEmbedRoute, firstSource } = require('./projectEmbed');

const fakeReq = (projectName = 'p1') => ({
  params: { projectName },
  log: { error: sinon.spy() }
});

const fakeRes = () => {
  const res = { headers: {}, headersSent: false };
  res.set = (name, value) => {
    res.headers[name] = value;

    return res;
  };
  res.redirect = (status, url) => {
    res.redirected = { status, url };
    res.headersSent = true;
  };

  return res;
};

const project = { shortname: 'p1', files: { list: [{ source: 'https://x.org/a' }, 'https://x.org/b'] } };

const fakeAdapter = (overrides = {}) => ({
  findProject: sinon.stub().resolves(project),
  mayEmbed: sinon.stub().resolves({ status: 200 }),
  embedURL: (source, shortname) => `/data/embed?${new URLSearchParams({ source, project: shortname })}`,
  embedError: sinon.spy((res, status, message) => {
    res.errored = { status, message };
    res.headersSent = true;
  }),
  noFilesMessage: 'This project has no dataset.',
  serverErrorMessage: 'This dataset could not be loaded.',
  ...overrides
});

describe('routes/projectEmbed: projectEmbedRoute', () => {
  it('sets Content-Security-Policy: frame-ancestors *, whatever the answer', async () => {
    for (const adapter of [fakeAdapter(), fakeAdapter({ findProject: sinon.stub().resolves(null) }), fakeAdapter({ findProject: sinon.stub().rejects(new Error('x')) })]) {
      const res = fakeRes();
      // eslint-disable-next-line no-await-in-loop
      await projectEmbedRoute(adapter)(fakeReq(), res);
      assert.strictEqual(res.headers['Content-Security-Policy'], 'frame-ancestors *');
    }
  });

  it('a 302 to the app\'s URL of the first file, after asking mayEmbed', async () => {
    const adapter = fakeAdapter();
    const req = fakeReq();
    const res = fakeRes();
    await projectEmbedRoute(adapter)(req, res);
    assert.deepEqual(adapter.findProject.firstCall.args, [req, 'p1']);
    assert.deepEqual(adapter.mayEmbed.firstCall.args, [req, { source: 'https://x.org/a', project }]);
    assert.deepEqual(res.redirected, { status: 302, url: '/data/embed?source=https%3A%2F%2Fx.org%2Fa&project=p1' });
    assert.isFalse(adapter.embedError.called);
  });

  it('no project: 404 "This project could not be found."', async () => {
    const adapter = fakeAdapter({ findProject: sinon.stub().resolves(null) });
    const res = fakeRes();
    await projectEmbedRoute(adapter)(fakeReq(), res);
    assert.deepEqual(res.errored, { status: 404, message: 'This project could not be found.' });
    assert.isFalse(adapter.mayEmbed.called);
    assert.notProperty(res, 'redirected');
  });

  it('no file: 404 with the app\'s noFilesMessage, mayEmbed not asked', async () => {
    const adapter = fakeAdapter({
      findProject: sinon.stub().resolves({ shortname: 'p1', files: { list: ['', null, {}] } }),
      noFilesMessage: 'This project has no brain to show.'
    });
    const res = fakeRes();
    await projectEmbedRoute(adapter)(fakeReq(), res);
    assert.deepEqual(res.errored, { status: 404, message: 'This project has no brain to show.' });
    assert.isFalse(adapter.mayEmbed.called);
  });

  it('a refusal: mayEmbed\'s status and message, and no URL', async () => {
    for (const decision of [{ status: 403, message: 'This content is private.' }, { status: 404, message: 'This project has no brain to show.' }]) {
      const adapter = fakeAdapter({ mayEmbed: sinon.stub().resolves(decision) });
      const res = fakeRes();
      // eslint-disable-next-line no-await-in-loop
      await projectEmbedRoute(adapter)(fakeReq(), res);
      assert.deepEqual(res.errored, decision);
      assert.notProperty(res, 'redirected');
    }
  });

  it('a thrown error: 500 with serverErrorMessage, logged with req.log', async () => {
    const err = new Error('db down');
    const adapter = fakeAdapter({ mayEmbed: sinon.stub().rejects(err) });
    const req = fakeReq();
    const res = fakeRes();
    await projectEmbedRoute(adapter)(req, res);
    assert.deepEqual(res.errored, { status: 500, message: 'This dataset could not be loaded.' });
    assert.strictEqual(req.log.error.callCount, 1);
    assert.strictEqual(req.log.error.firstCall.args[0].err, err);
  });

  it('a thrown error after headers were sent: nothing more is sent', async () => {
    const adapter = fakeAdapter({ embedURL: () => { throw new Error('late'); } });
    const req = fakeReq();
    const res = fakeRes();
    res.headersSent = true;
    await projectEmbedRoute(adapter)(req, res);
    assert.isFalse(adapter.embedError.called);
    assert.strictEqual(req.log.error.callCount, 1);
  });
});

describe('routes/projectEmbed: firstSource', () => {
  it('the first non-empty string, from strings or {source} objects', () => {
    assert.strictEqual(firstSource({ files: { list: ['a', 'b'] } }), 'a');
    assert.strictEqual(firstSource({ files: { list: [{ source: 'a' }, 'b'] } }), 'a');
    assert.strictEqual(firstSource({ files: { list: ['', { source: '' }, null, { source: 3 }, {}, { source: 'c' }] } }), 'c');
  });

  it('null for blanks, a missing list or no project', () => {
    assert.isNull(firstSource({ files: { list: ['', { source: '' }, null] } }));
    assert.isNull(firstSource({ files: { list: [] } }));
    assert.isNull(firstSource({ files: { list: 'a' } }));
    assert.isNull(firstSource({ files: {} }));
    assert.isNull(firstSource({}));
    assert.isNull(firstSource(null));
  });
});
