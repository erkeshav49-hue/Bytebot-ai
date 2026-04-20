const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Exclude .local/skills directory from Metro watcher to avoid ENOENT errors
// from non-existent symlinked paths inside the skills directory
config.watchFolders = (config.watchFolders || []).filter(
  (folder) => !String(folder).includes(".local")
);

// Add blockList to exclude .local directory from Metro's file scanning
config.resolver = {
  ...config.resolver,
  blockList: [/\.local\/.*/],
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});
