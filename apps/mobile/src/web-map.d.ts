// Types for the two web-only imports the MapLibre map needs (plan D21).

// Expo's web bundler loads plain CSS files; the map library ships one.
declare module '*.css';

// react-dom is installed with react-native-web but has no type package here; the map only uses createPortal.
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element): ReactPortal;
}
