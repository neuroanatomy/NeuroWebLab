const { assert } = require('chai');

const nwl = require('../index');
const util = require('../util');
const project = require('../project');
const projectSave = require('../project/save');
const projectRules = require('../project/rules');
const admin = require('../admin');
const adminAdmins = require('../admin/admins');
const adminActions = require('../admin/actions');
const embed = require('../embed');
const embedTickets = require('../embed/tickets');
const routesProjectEmbed = require('../routes/projectEmbed');
const routesNotFound = require('../routes/notFound');
const sessionUser = require('../auth/sessionUser');
const dbEscapeRegex = require('../db/escapeRegex');
const conformance = require('../conformance');
const packageJSON = require('../package.json');

// what `require('neuroweblab')` gives the apps
describe('root exports', () => {
  it('every 1.7.0 export is still there', () => {
    for (const name of ['ObjectId', 'authTokenMiddleware', 'init', 'getTokenEndPoint', 'version', 'AccessLevel', 'AccessType', 'AccessControlService']) {
      assert.property(nwl, name);
      assert.exists(nwl[name], name);
    }
    assert.match(nwl.version(), /^v\d+\.\d+\.\d+$/);
  });

  it('1.8.0: each shared helper is exported, as the module that holds it', () => {
    for (const name of ['escapeRegex', 'jsonForScript', 'jsonForAttribute', 'toId', 'catchErrors']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], util[name], name);
    }
    assert.isFunction(nwl.usernameFromCookie);
    assert.strictEqual(nwl.usernameFromCookie, sessionUser.usernameFromCookie);
    assert.strictEqual(nwl.escapeRegex, dbEscapeRegex.escapeRegex);
  });

  it('1.9.0: each save helper is exported, as the module that holds it', () => {
    for (const name of ['canSaveProject', 'keepFieldsWithoutFilesEdit', 'saveRefusal', 'ignoredChangesMessage', 'filesListIncomplete']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], project[name], name);
      assert.strictEqual(nwl[name], projectSave[name], name);
    }
  });

  it('1.10.0: each validation helper is exported, as the module that holds it', () => {
    for (const name of ['plainText', 'sanitize', 'isBlank', 'text', 'listOf', 'sortRows', 'droppedMessage']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], project[name], name);
      assert.strictEqual(nwl[name], projectRules[name], name);
    }
    for (const name of ['isBlankRow', 'shortnamePattern']) {
      assert.exists(nwl[name], name);
      assert.strictEqual(nwl[name], project[name], name);
      assert.strictEqual(nwl[name], projectRules[name], name);
    }
    assert.instanceOf(nwl.shortnamePattern, RegExp);
    for (const type of ['files', 'collaborators', 'annotations']) {
      assert.isFunction(nwl.isBlankRow[type], type);
    }
  });

  it('1.11.0: each admin export is exported, as the module that holds it', () => {
    for (const name of ['createAdmins', 'requestUsername']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], admin[name], name);
      assert.strictEqual(nwl[name], adminAdmins[name], name);
    }
    for (const name of ['sendResult', 'adminLog']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], admin[name], name);
      assert.strictEqual(nwl[name], adminActions[name], name);
    }
    const admins = nwl.createAdmins();
    for (const name of ['getAdmins', 'setAdmins', 'isAdmin', 'requestUsername', 'requireAdmin', 'adminPage']) {
      assert.isFunction(admins[name], name);
    }
  });

  it('1.12.0: each embed export is exported, as the module that holds it', () => {
    for (const name of ['mintWsTicket', 'findWsTicket', 'ensureTicketIndex']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], embed[name], name);
      assert.strictEqual(nwl[name], embedTickets[name], name);
    }
    assert.strictEqual(nwl.WS_TICKET_COLLECTION, 'embedWsTicket');
    assert.strictEqual(nwl.WS_TICKET_DURATION, 6 * 3600 * 1000);
    assert.strictEqual(nwl.WS_TICKET_COLLECTION, embedTickets.WS_TICKET_COLLECTION);
    assert.strictEqual(nwl.WS_TICKET_DURATION, embedTickets.WS_TICKET_DURATION);
    for (const name of ['projectEmbedRoute', 'firstSource']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], routesProjectEmbed[name], name);
    }
  });

  it('1.13.0: the 404 and error handler exports are exported, as the module that holds them', () => {
    for (const name of ['wantsJSON', 'wantsPage', 'displayPath', 'notFound', 'errorHandler']) {
      assert.isFunction(nwl[name], name);
      assert.strictEqual(nwl[name], routesNotFound[name], name);
    }
    assert.lengthOf(nwl.notFound(), 2);
    assert.lengthOf(nwl.errorHandler(), 4);
  });

  it('every 1.12.0 export is still there', () => {
    for (const name of ['mintWsTicket', 'findWsTicket', 'ensureTicketIndex', 'projectEmbedRoute', 'firstSource']) {
      assert.isFunction(nwl[name], name);
    }
    assert.exists(nwl.WS_TICKET_COLLECTION);
    assert.exists(nwl.WS_TICKET_DURATION);
  });

  it('every 1.11.0 export is still there', () => {
    for (const name of ['createAdmins', 'requestUsername', 'sendResult', 'adminLog']) {
      assert.isFunction(nwl[name], name);
    }
  });

  it('every 1.10.0 export is still there', () => {
    for (const name of ['plainText', 'sanitize', 'isBlank', 'text', 'listOf', 'sortRows', 'droppedMessage', 'isBlankRow', 'shortnamePattern']) {
      assert.exists(nwl[name], name);
    }
  });

  it('every 1.9.0 export is still there', () => {
    for (const name of ['canSaveProject', 'keepFieldsWithoutFilesEdit', 'saveRefusal', 'ignoredChangesMessage', 'filesListIncomplete']) {
      assert.isFunction(nwl[name], name);
    }
  });

  it('every 1.8.0 export is still there', () => {
    for (const name of ['escapeRegex', 'jsonForScript', 'jsonForAttribute', 'toId', 'catchErrors', 'usernameFromCookie']) {
      assert.isFunction(nwl[name], name);
    }
  });

  it('toId gives the root ObjectId', () => {
    assert.instanceOf(nwl.toId('0123456789abcdef01234567'), nwl.ObjectId);
  });

  it('deep paths still work (no "exports" field)', () => {
    assert.notProperty(packageJSON, 'exports');
    assert.isFunction(conformance.projectLifecycle);
  });
});
