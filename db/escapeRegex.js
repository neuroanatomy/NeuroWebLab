/**
 * Escape the characters that have a meaning in a regular expression, so
 * that user input is matched literally in a MongoDB $regex (as BrainBox's
 * and microdraw's escapeRegex). Without it, a search text such as `(a+)+$`
 * is a ReDoS, and `.` or `*` match more than asked.
 * @param {string} str Text typed by a user
 * @returns {string} The text with regex characters escaped
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { escapeRegex };
