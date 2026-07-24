module.exports = {
  appId: "dev.kumaraarav.murmur",
  afterPack: "../../scripts/after-pack.cjs",
  productName: "Murmur",
  directories: {
    output: "../../dist"
  },
  linux: {
    category: "Utility",
    syncDesktopName: true,
    maintainer: "Kumar Aarav <kumaraarav@kumaraarav.dev>",
    synopsis: "System-wide AI dictation",
    description: "System-wide AI dictation",
    target: ["AppImage", "deb", "rpm"]
  },
  mac: {
    category: "public.app-category.utilities",
    target: ["dmg", "zip"],
    minimumSystemVersion: "13.0",
    extendInfo: {
      NSMicrophoneUsageDescription: "Murmur records microphone audio only while dictation is active."
    }
  },
  files: ["out/**", "package.json"],
  extraResources: [
    {
      from: "../../resources/bin",
      to: "bin",
      filter: ["linux-fast-paste", "murmur-macos-helper"]
    },
    {
      from: "../../.cache/bundled-runtimes/runtimes",
      to: "runtimes",
      filter: ["**/*", "!.murmur-runtime-staging"]
    }
  ]
};
