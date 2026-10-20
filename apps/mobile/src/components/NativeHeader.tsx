import type React from 'react';

/** The web keeps each screen's own header row, so there is no system header to fill in. (The phone apps use NativeHeader.native.tsx.) */
export function NativeHeader(_props: { title: string; right?: React.ReactNode; titleView?: React.ReactNode }): null {
  return null;
}
