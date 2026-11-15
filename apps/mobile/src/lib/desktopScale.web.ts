import { useLayoutEffect } from 'react';
import { useLayout } from './layout';

/**
 * Web only. Zooms the whole page on a desktop browser by the scale from
 * lib/layout.ts (docs/design/desktop-fit/PLAN.md, Q2), and clears it below
 * desktop width. CSS zoom reflows the page, so text, controls, spacing and
 * sheets all grow together and every layout measurement stays in design px.
 * Call it once, at the root of the web app; it follows window resizes.
 */
export function useDesktopScale(): void {
  const { scale } = useLayout();
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.zoom = scale === 1 ? '' : String(scale);
  }, [scale]);
}
