/* eslint-disable no-sync */
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Make a temporary directory holding one file (replaces mock-fs, which
 * doesn't work on Node 26).
 * @param {string} filename File name
 * @param {string} content File content
 * @returns {string} The directory path
 */
const makeTmpDirWithFile = (filename, content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwl-test-'));
  fs.writeFileSync(path.join(dir, filename), content);

  return dir;
};

/**
 * Remove a directory made by makeTmpDirWithFile.
 * @param {string} dir The directory
 * @returns {void}
 */
const removeTmpDir = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
};

module.exports = {
  makeTmpDirWithFile,
  removeTmpDir
};
