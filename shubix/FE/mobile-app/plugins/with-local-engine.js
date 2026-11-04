const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

// The hidden engine page is served by the app itself on http://127.0.0.1 (FileServer.kt). Plain http is allowed for that
// one address only; everything else stays https.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

module.exports = (config) => withAndroidManifest(withDangerousMod(config, ["android", (c) => {
  const dir = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "res", "xml");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "network_security_config.xml"), XML);
  return c;
}]), (c) => {
  c.modResults.manifest.application[0].$["android:networkSecurityConfig"] = "@xml/network_security_config";
  return c;
});
