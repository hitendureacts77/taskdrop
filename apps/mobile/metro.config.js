// Metro config for the TaskDrop monorepo: watch the workspace root so Metro can
// resolve the shared @taskdrop/* packages, and read node_modules from both the
// app and the root.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Hierarchical lookup stays ON, deliberately.
//
// Turning it off restricts resolution to the two folders above, which breaks
// any dependency npm nests rather than hoists. react-native is exactly that
// case: it depends on @react-native/virtualized-lists, npm installs it at
// react-native/node_modules/@react-native/virtualized-lists, and with
// hierarchical lookup disabled Metro never looks there — so FlatList and Modal
// fail to resolve and the Android bundle dies.
//
// It did not show up on web, because react-native-web imports neither.
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
