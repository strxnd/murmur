const base = require("./electron-builder.base.cjs");

module.exports = {
  ...base,
  mac: {
    ...base.mac,
    identity: null,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    notarize: false
  }
};
