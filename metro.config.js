// metro.config.js — only exists for one fix: force a single resolved copy
// of "three" everywhere (see below). No other project-wide resolver
// behavior is changed.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// three's package.json exports both an "import" and a "require" condition
// pointing at DIFFERENT files (three.module.js vs three.cjs). Metro keys
// modules by resolved file path, so our own `import ... from 'three'`
// (features/kolobok's proceduralTextures.js) and @react-three/fiber's
// internal `require('three')` were landing on two different files --
// two separate THREE.Object3D classes, so R3F's internal instanceof-based
// reconciliation silently failed to attach any mesh/group to the scene
// (Canvas mounted, background color showed, but nothing else rendered).
// Pinning the "three" specifier to one file, for every importer, fixes it.
const THREE_ENTRY = path.resolve(__dirname, 'node_modules/three/build/three.module.js');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { type: 'sourceFile', filePath: THREE_ENTRY };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
