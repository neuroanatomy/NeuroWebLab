const log = require('why-is-node-running'); // should be your first require

setTimeout(function () {
  log(); // logs out active handles that are keeping node running
}, 30000);
