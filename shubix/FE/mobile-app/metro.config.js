const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Expo SDK 58 detects the pnpm workspace root and linked packages automatically.
// Watching the entire monorepo here also watches its node_modules tree on Windows,
// which can time out Metro's file watcher before the NativeWind transformer starts.
const config = getDefaultConfig(__dirname);

// One NativeWind for the whole app: pnpm gives shared/ui-mobile its own copy, and the look's colours (vars() in
// shared/ui-mobile/src/theme.tsx) are only seen by the copy that set them, so on a phone every colour class went
// missing (black borders, no gold). These packages always load from the app's own node_modules.
const ONE_COPY = ["nativewind", "react-native-css-interop"];
const fromApp = path.join(__dirname, "package.json");
config.resolver.resolveRequest = (context, name, platform) =>
  context.resolveRequest(ONE_COPY.some((p) => name === p || name.startsWith(p + "/")) ? { ...context, originModulePath: fromApp } : context, name, platform);

module.exports = withNativeWind(config, { input: "./global.css" });
