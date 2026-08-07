const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add support for .mjs extensions (required by lucide-react-native exports)
config.resolver.sourceExts.push('mjs');

module.exports = config;
