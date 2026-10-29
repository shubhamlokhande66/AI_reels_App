const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("node:path");

// pnpm monorepo: watch the whole workspace (Shared/*) and resolve from this app and the root node_modules
const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules"), path.resolve(root, "node_modules")];
module.exports = withNativeWind(config, { input: "./global.css" });
