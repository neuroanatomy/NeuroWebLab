/**
 * The label sets of a folder, and GET /api/getLabelsets (NeuroWebLab 1.15.0),
 * from microdraw's app/controller/api/labelsets.js (`listLabelSets`,
 * `getLabelsets`) and BrainBox's controller/api/api.controller.js
 * (`getLabelsets`). microdraw's code is the reference, with its default first
 * (10regions.json) made an option.
 *
 * The answer is [{name, source}], `source` being the file name (a project's
 * vectorial layer stores it in `values`). The folder is read on each request:
 * it holds a few small files, and a file added by the maintainer is listed
 * without a restart. No path comes from the request, so nothing outside the
 * folder is ever read.
 */
const fs = require('fs');
const path = require('path');
const { catchErrors } = require('../util/catchErrors');

/**
 * microdraw's `defaultFirst`: `first` before the others, then by file name,
 * compared by code point (not `localeCompare`)
 * @param {string} [first] A file name
 * @returns {function} A sort comparator of file names
 */
const firstThenByName = (first) => (a, b) => Number(b === first) - Number(a === first) || (a < b ? -1 : Number(a > b));

/**
 * The label sets of a folder: its `*.json` regular files, `first` first, then
 * by file name. A file that is not valid JSON, or has no string `name`, is
 * skipped and logged.
 * @param {string} dir The folder
 * @param {Object} [options] Options
 * @param {string} [options.first] A file name listed before the others (ignored if absent)
 * @param {Object} [options.logger] Logs a skipped file with `warn`; `console` by default
 * @returns {Promise<Array<{name: string, source: string}>>} The label sets; rejects if the folder is missing
 */
const listLabelSets = async (dir, { first, logger = console } = {}) => {
  const files = (await fs.promises.readdir(dir, { withFileTypes: true }))
    .filter((f) => f.isFile() && f.name.endsWith('.json'))
    .map((f) => f.name)
    .sort(firstThenByName(first));
  const sets = await Promise.all(files.map(async (file) => {
    try {
      const json = JSON.parse(await fs.promises.readFile(path.join(dir, file), 'utf8'));
      if (json === null || typeof json !== 'object' || typeof json.name !== 'string') {
        throw new Error('no name');
      }

      return { name: json.name, source: file };
    } catch (err) {
      logger.warn({ err, file }, 'label set skipped: not a valid label set file');

      return null;
    }
  }));

  return sets.filter((s) => s !== null);
};

/**
 * The Express handler of GET /api/getLabelsets
 * @param {string} dir The folder of the label sets
 * @param {Object} [options] As `listLabelSets`'s: `first`, `logger`
 * @returns {function} An async Express handler answering JSON; an error (a
 *          missing folder) is logged with `req.log` or `console` and answers
 *          500 `{error: 'Server error'}`
 */
const labelSetsRoute = (dir, options = {}) => {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new TypeError('labelSetsRoute: dir must be a non-empty string (the folder of the label sets)');
  }

  return catchErrors(async (req, res) => {
    res.json(await listLabelSets(dir, options));
  });
};

module.exports = { listLabelSets, labelSetsRoute };
