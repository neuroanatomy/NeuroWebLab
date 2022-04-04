const path = require('path');

const getMockfsConfig = (dirname, filename, content) => {
  const obj = {};
  obj[path.join(dirname, filename)] = content;

  return obj;
};

module.exports = {
  getMockfsConfig
};
