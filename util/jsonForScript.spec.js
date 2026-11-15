const { assert } = require('chai');
const { jsonForScript, jsonForAttribute } = require('./index');

// Built from char codes, never written literally: a literal U+2028 in a source
// file is an invisible line terminator that breaks the expression holding it.
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const SCRIPT_NAME = '</script><script>window.h2bInjected=true</script>';

describe('util: jsonForScript', () => {
  // microdraw script-json.spec.js
  it('leaves no "<" or ">" and parses back to the same value', () => {
    const value = { name: SCRIPT_NAME, other: `a & b ${LINE_SEPARATOR} ${PARAGRAPH_SEPARATOR} <` };
    const json = jsonForScript(value);
    assert.notMatch(json, /[<>]/);
    assert.deepEqual(JSON.parse(json), value);
  });

  // BrainBox json-for-script.spec.js
  it('does not let a value close the script element', () => {
    const out = jsonForScript({ x: '</script><img src=x onerror=alert(1)>' });
    assert.notInclude(out.toLowerCase(), '</script');
  });

  it('escapes every angle bracket, wherever it appears', () => {
    const out = jsonForScript({ a: '<b>', c: ['<', '>'], '<key>': 1 });
    assert.notInclude(out, '<');
    assert.notInclude(out, '>');
  });

  it('escapes the start of an HTML comment', () => {
    assert.notInclude(jsonForScript({ x: '<!--' }), '<!--');
  });

  it('escapes U+2028 and U+2029', () => {
    const out = jsonForScript({ x: `a${LINE_SEPARATOR}b${PARAGRAPH_SEPARATOR}c` });
    assert.notInclude(out, LINE_SEPARATOR);
    assert.notInclude(out, PARAGRAPH_SEPARATOR);
    assert.include(out, '\\u2028');
    assert.include(out, '\\u2029');
  });

  it('does not change what the value means', () => {
    const value = {
      name: '</script>',
      nested: { list: ['<a>', 'plain', LINE_SEPARATOR], n: 42, t: true, nil: null },
      unicode: 'héllo wörld 中文'
    };
    assert.deepStrictEqual(JSON.parse(jsonForScript(value)), value);
  });

  it('handles the values the routes pass it', () => {
    assert.strictEqual(JSON.parse(jsonForScript('a-ticket-string')), 'a-ticket-string');
    assert.deepStrictEqual(JSON.parse(jsonForScript({})), {});
    assert.deepStrictEqual(JSON.parse(jsonForScript([])), []);
  });

  // not tested by either app
  it('escapes "</script>", "<!--", U+2028, U+2029 and "&" to their exact \\u escapes', () => {
    const value = `</script> <!-- ${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR} a&b`;
    assert.equal(
      jsonForScript(value),
      '"\\u003c/script\\u003e \\u003c!-- \\u2028\\u2029 a\\u0026b"'
    );
    assert.equal(JSON.parse(jsonForScript(value)), value);
  });

  it('escapes "&" (microdraw\'s rule), so no entity can be read in the script', () => {
    const out = jsonForScript({ x: 'a &amp; b &#39; &' });
    assert.notInclude(out, '&');
    assert.deepEqual(JSON.parse(out), { x: 'a &amp; b &#39; &' });
  });
});

describe('util: jsonForAttribute', () => {
  // BrainBox json-for-script.spec.js
  it('does not let a value end a single-quoted attribute or start an entity', () => {
    const value = { name: 'O\'Brien &quot;x&#39; </script>' };
    const out = jsonForAttribute(value);
    assert.notMatch(out, /['&<>]/);
    assert.deepStrictEqual(JSON.parse(out), value);
  });

  it('is jsonForScript with "\'" escaped as well', () => {
    assert.equal(jsonForAttribute('it\'s <a&b>'), '"it\\u0027s \\u003ca\\u0026b\\u003e"');
    assert.equal(jsonForAttribute({ n: 1 }), jsonForScript({ n: 1 }));
  });
});
