// Google Play's upload key in the release build (android/ is made by `expo prebuild` and not kept in git, so the change
// is made here, each time): android/keystore.properties (never in git) names the key file and its passwords. Without that
// file the release build keeps the debug key (a test APK only, which Play does not accept).
const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING = `
        // Google Play's upload key: android/keystore.properties (never in git) names the key file and its passwords
        def ksFile = rootProject.file('keystore.properties')
        if (ksFile.exists()) {
            def ks = new Properties(); ksFile.withInputStream { ks.load(it) }
            release {
                storeFile file(ks['storeFile']); storePassword ks['storePassword']; keyAlias ks['keyAlias']; keyPassword ks['keyPassword']
            }
        }`;

module.exports = (config) => withAppBuildGradle(config, (c) => {
  let g = c.modResults.contents;
  if (!g.includes("keystore.properties")) {
    g = g.replace(/(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/, `$1${SIGNING}`);
    g = g.replace(/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig rootProject.file('keystore.properties').exists() ? signingConfigs.release : signingConfigs.debug");
  }
  c.modResults.contents = g;
  return c;
});
