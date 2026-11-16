const { assert } = require('chai');
const sinon = require('sinon');
const express = require('express');
const { listen, close } = require('../test/http');
const { wantsJSON, wantsPage, displayPath, notFound, errorHandler } = require('./notFound');

const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/**
 * A request as Express sees it, from a small app that answers what the
 * helper says about it
 * @param {function} fn (req) => value
 * @returns {Promise<function>} (pathname, {method, accept}) => the value
 */
const probe = async (fn) => {
  const app = express();
  app.use((req, res) => {
    res.set('X-Value', JSON.stringify(fn(req)));
    res.end();
  });
  const { server, url } = await listen(app);
  const ask = async (pathname, { method = 'GET', accept = HTML } = {}) => {
    const res = await fetch(url + pathname, { method, headers: { Accept: accept } });

    return JSON.parse(res.headers.get('X-Value'));
  };
  ask.server = server;

  return ask;
};

/**
 * A view that answers its name and the locals the templates read, in JSON:
 * no template files are needed
 */
class FakeView {
  constructor(name) {
    this.name = name;
    this.path = name;
  }

  render(locals, cb) {
    const { message, path, error } = locals;
    cb(null, JSON.stringify({
      view: this.name,
      message,
      path,
      error: error && { status: error.status, stack: Boolean(error.stack) }
    }));
  }
}

/**
 * An app with a view that answers the view's name and locals in JSON,
 * a route per error, then the given 404 and error handlers
 * @param {Object} handlers { notFound, errorHandler }
 * @param {string} env The app's env
 * @returns {Promise<Object>} { server, url }
 */
const makeApp = (handlers, env = 'production') => {
  const app = express();
  app.set('env', env);
  app.set('view', FakeView);
  app.get('/fail/:status', (req, _res, next) => {
    const err = new Error('secret detail');
    if (req.params.status !== 'none') { err.status = Number(req.params.status); }
    next(err);
  });
  app.get('/fail-code/:status', (req, _res, next) => {
    const err = new Error('coded detail');
    err.statusCode = Number(req.params.status);
    next(err);
  });
  app.get('/sent', (_req, res, next) => {
    res.status(200).write('partial');
    next(new Error('after headers'));
  });
  if (handlers.notFound) { app.use(handlers.notFound); }
  app.use(handlers.errorHandler);
  // after the handler: what it passed on
  // eslint-disable-next-line max-params, no-unused-vars
  app.use((err, _req, res, _next) => { res.end(` passed on: ${err.message}`); });

  return listen(app);
};

describe('routes/notFound', () => {
  describe('wantsJSON', () => {
    let ask;
    before(async () => { ask = await probe(wantsJSON); });
    after(() => close(ask.server));

    it('a request that accepts JSON first', async () => {
      assert.isTrue(await ask('/page', { accept: 'application/json' }));
      assert.isTrue(await ask('/page', { accept: 'application/json, text/html;q=0.5' }));
    });
    it('a path under /api/', async () => {
      assert.isTrue(await ask('/api/x'));
    });
    it('a JSON path, with or without a slash after /json', async () => {
      assert.isTrue(await ask('/a/json/b'));
      assert.isTrue(await ask('/a/json'));
    });
    it('not /a/jsonx, nor an HTML request', async () => {
      assert.isFalse(await ask('/a/jsonx'));
      assert.isFalse(await ask('/a/page'));
    });
  });

  describe('wantsPage', () => {
    let ask;
    before(async () => { ask = await probe(wantsPage); });
    after(() => close(ask.server));

    it('GET or HEAD, not POST', async () => {
      assert.isTrue(await ask('/a'));
      assert.isTrue(await ask('/a', { method: 'HEAD' }));
      assert.isFalse(await ask('/a', { method: 'POST' }));
    });
    it('no extension, .html or .htm; not .js or .png', async () => {
      assert.isTrue(await ask('/a/b'));
      assert.isTrue(await ask('/a/b.html'));
      assert.isTrue(await ask('/a/B.HTM'));
      assert.isFalse(await ask('/a/b.js'));
      assert.isFalse(await ask('/a/b.png'));
    });
    it('Accept: */* is a page only without an asset extension', async () => {
      assert.isTrue(await ask('/a/b', { accept: '*/*' }));
      assert.isFalse(await ask('/a/b.js', { accept: '*/*' }));
    });
    it('not a JSON request', async () => {
      assert.isFalse(await ask('/a/b', { accept: 'application/json' }));
    });
  });

  describe('displayPath', () => {
    let ask;
    before(async () => { ask = await probe(displayPath); });
    after(() => close(ask.server));

    it('decodes the path', async () => {
      assert.strictEqual(await ask('/a%20b/%C3%A9'), '/a b/é');
    });
    it('gives a malformed escape as sent', async () => {
      assert.strictEqual(await ask('/a%E0%A4%A'), '/a%E0%A4%A');
    });
  });

  describe('notFound', () => {
    let app;
    before(async () => { app = await makeApp({ notFound: notFound(), errorHandler: errorHandler() }); });
    after(() => close(app.server));

    it('a JSON request: 404 {error: "Not found"}', async () => {
      const res = await fetch(`${app.url}/api/none`);
      assert.strictEqual(res.status, 404);
      assert.match(res.headers.get('content-type'), /^application\/json/);
      assert.deepEqual(await res.json(), { error: 'Not found' });
    });
    it('a page: 404, the "error" view with the message and the decoded path', async () => {
      const res = await fetch(`${app.url}/no/such%20page`, { headers: { Accept: HTML } });
      assert.strictEqual(res.status, 404);
      assert.deepEqual(await res.json(), { view: 'error', message: 'Page not found', path: '/no/such page' });
    });
    it('anything else: 404 plain text', async () => {
      const res = await fetch(`${app.url}/lib/x.js`, { headers: { Accept: '*/*' } });
      assert.strictEqual(res.status, 404);
      assert.match(res.headers.get('content-type'), /^text\/plain/);
      assert.strictEqual(await res.text(), 'Not found');
    });
    it('a custom view', async () => {
      const custom = await makeApp({ notFound: notFound({ view: 'missing' }), errorHandler: errorHandler() });
      const res = await fetch(`${custom.url}/no/page`, { headers: { Accept: HTML } });
      await close(custom.server);
      assert.strictEqual(res.status, 404);
      assert.strictEqual((await res.json()).view, 'missing');
    });
  });

  describe('errorHandler', () => {
    let consoleError;
    beforeEach(() => { consoleError = sinon.stub(console, 'error'); });
    afterEach(() => consoleError.restore());

    const run = async (options, env, pathname, accept = HTML) => {
      const app = await makeApp({ errorHandler: errorHandler(options) }, env);
      const res = await fetch(app.url + pathname, { headers: { Accept: accept } });
      const text = await res.text();
      await close(app.server);

      return { status: res.status, type: res.headers.get('content-type'), text };
    };

    it('a 4xx page shows its message and {status}, in production', async () => {
      const res = await run({}, 'production', '/fail/403');
      assert.strictEqual(res.status, 403);
      assert.deepEqual(JSON.parse(res.text), { view: 'error', message: 'secret detail', error: { status: 403, stack: false } });
    });
    it('a 5xx page hides its message and the stack, in production', async () => {
      const res = await run({}, 'production', '/fail/none');
      assert.strictEqual(res.status, 500);
      assert.deepEqual(JSON.parse(res.text), { view: 'error', message: 'Server error', error: { status: 500, stack: false } });
      assert.notInclude(res.text, 'secret detail');
    });
    it('a 5xx page shows its message and the error, in development', async () => {
      const res = await run({}, 'development', '/fail/502');
      assert.strictEqual(res.status, 502);
      assert.deepEqual(JSON.parse(res.text), { view: 'error', message: 'secret detail', error: { status: 502, stack: true } });
    });
    it('a 4xx page in development gets the error', async () => {
      const res = await run({}, 'development', '/fail/404');
      assert.deepEqual(JSON.parse(res.text).error, { status: 404, stack: true });
    });
    it('a JSON request is answered in JSON: 5xx hidden in production, shown in development; 4xx shown', async () => {
      const prod = await run({}, 'production', '/fail/500', 'application/json');
      assert.strictEqual(prod.status, 500);
      assert.match(prod.type, /^application\/json/);
      assert.deepEqual(JSON.parse(prod.text), { error: 'Server error' });
      const dev = await run({}, 'development', '/fail/500', 'application/json');
      assert.deepEqual(JSON.parse(dev.text), { error: 'secret detail' });
      const client = await run({}, 'production', '/fail/409', 'application/json');
      assert.strictEqual(client.status, 409);
      assert.deepEqual(JSON.parse(client.text), { error: 'secret detail' });
    });
    it('reads err.statusCode', async () => {
      const res = await run({}, 'production', '/fail-code/422', 'application/json');
      assert.strictEqual(res.status, 422);
      assert.deepEqual(JSON.parse(res.text), { error: 'coded detail' });
    });
    it('passes the error on when headers were sent, without onError', async () => {
      const onError = sinon.spy();
      const res = await run({ onError }, 'production', '/sent');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.text, 'partial passed on: after headers');
      assert.isFalse(onError.called);
    });
    it('calls onError for every status, before answering', async () => {
      const seen = [];
      const onError = (err, req, res) => { seen.push([err.status, req.path, res.headersSent]); };
      await run({ onError }, 'production', '/fail/404');
      await run({ onError }, 'production', '/fail/500');
      assert.deepEqual(seen, [[404, '/fail/404', false], [500, '/fail/500', false]]);
      assert.isFalse(consoleError.called);
    });
    it('logs BrainBox\'s line by default, for a 5xx only', async () => {
      await run({}, 'production', '/fail/404');
      assert.isFalse(consoleError.called);
      await run({}, 'production', '/fail/503');
      assert.isTrue(consoleError.calledOnce);
      const [label, method, url, err] = consoleError.firstCall.args;
      assert.deepEqual([label, method, url, err.message], ['ERROR:', 'GET', '/fail/503', 'secret detail']);
    });
    it('a custom isDevelopment and view', async () => {
      const res = await run({ isDevelopment: (req) => req.path === '/fail/500', view: 'oops' }, 'production', '/fail/500');
      assert.deepEqual(JSON.parse(res.text), { view: 'oops', message: 'secret detail', error: { status: 500, stack: true } });
    });
  });
});
