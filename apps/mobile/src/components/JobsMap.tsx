// Web build: the tile map. Native builds resolve JobsMap.native.tsx instead, which uses
// Google Maps (OpenStreetMap refuses tile requests from apps) and falls back to these tiles in Expo Go.
export { JobsMap, type JobPin } from './JobsMap.tiles';
