const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

// Expo SDK 58 detects the pnpm workspace root and linked packages automatically.
// Watching the entire monorepo here also watches its node_modules tree on Windows,
// which can time out Metro's file watcher before the NativeWind transformer starts.
const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
