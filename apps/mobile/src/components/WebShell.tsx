import React from 'react';

/**
 * The web used to squeeze the whole app into a 430px phone frame on any wide
 * browser. It no longer does: a phone or narrow window gets the phone layout
 * edge to edge, and a desktop browser gets the desktop layout (sidebar, wide
 * content, dialogs) — see lib/layout.ts and ScreenHost. Kept as the one place
 * web-only wrapping would go.
 */
export function WebShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
