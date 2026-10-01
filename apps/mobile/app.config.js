// Layered on top of app.json. The only thing added here is the Google Maps key
// for installed Android builds, read from the environment so it never has to
// be committed. Expo Go is a separate app and ignores this (the map picker
// shows tiles there instead).
//
// The key has to go through react-native-maps' own config plugin. That plugin
// runs on every build, and when it is not handed a key it *removes* the
// manifest entry -- so setting `android.config.googleMaps.apiKey` alone left
// installed builds with a blank map.
module.exports = ({ config }) => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!mapsKey) return config;
  const plugins = (config.plugins ?? []).filter(
    (p) => (Array.isArray(p) ? p[0] : p) !== 'react-native-maps',
  );
  return {
    ...config,
    plugins: [...plugins, ['react-native-maps', { androidGoogleMapsApiKey: mapsKey }]],
  };
};
