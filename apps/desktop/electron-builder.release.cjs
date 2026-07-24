const path = require("node:path");
const base = require("./electron-builder.base.cjs");

const entitlements = path.join(__dirname, "../../resources/macos/entitlements.mac.plist");

module.exports = {
  ...base,
  mac: {
    ...base.mac,
    hardenedRuntime: true,
    // Signing-time Gatekeeper assessment runs before notarization; dist:release verifies it after stapling instead.
    gatekeeperAssess: false,
    entitlements,
    entitlementsInherit: entitlements,
    notarize: true
  }
};
