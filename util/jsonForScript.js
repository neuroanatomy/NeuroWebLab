/**
 * JSON that the server writes into an HTML page (microdraw's `scriptJSON`,
 * BrainBox's `jsonForScript`; the rule is microdraw's, which also escapes `&`).
 *
 * `JSON.stringify` alone is not safe inside an inline <script>: HTML parsing
 * comes before JavaScript parsing, so a string holding `</script` (a project,
 * annotation, MRI or user name) ends the script element and the rest runs as
 * HTML, and `<!--` can swallow the rest of the page. Escaping `<`, `>` and `&`
 * as JSON \u escapes keeps the same value once parsed. U+2028/U+2029 are valid
 * in JSON strings but line terminators to older JavaScript parsers, so they go
 * too.
 */

/**
 * @param {*} value Any JSON-serialisable value
 * @returns {string} JSON safe between <script> and </script> (a Mustache `{{{ }}}`)
 */
const jsonForScript = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

/**
 * Like `jsonForScript`, for a single-quoted HTML attribute (such as a Vue
 * `:prop='...'` binding in a template held in a <script type="text/html">):
 * `'` would end the attribute, and `&` would start an entity that the template
 * compiler decodes back into a quote, so both are JSON escapes as well.
 * @param {*} value Any JSON-serialisable value
 * @returns {string} JSON safe inside '...' in an inline template
 */
const jsonForAttribute = (value) => jsonForScript(value).replace(/['&]/g, (c) => (c === '\'' ? '\\u0027' : '\\u0026'));

module.exports = { jsonForScript, jsonForAttribute };
