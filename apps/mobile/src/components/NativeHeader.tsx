import type React from 'react';

/** The web keeps TopBar's own row, so there is no system header to fill in. (The phone apps use NativeHeader.native.tsx.) */
export function NativeHeader(_props: { title: string; right?: React.ReactNode }): null {
  return null;
}
