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

/**
 * How many real window px one design px is right now: the desktop zoom as the
 * browser applies it to getBoundingClientRect (and so to measureInWindow).
 * Read from the page itself rather than from `scale`, so it is right in every
 * browser's take on zoom, and 1 when nothing is zoomed.
 */
export function pageZoom(): number {
  if (typeof document === 'undefined' || !document.documentElement.style.zoom) return 1;
  const body = document.body;
  const ratio = body && body.offsetWidth > 0 ? body.getBoundingClientRect().width / body.offsetWidth : 1;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * A rect measured in real window px (measureInWindow, getBoundingClientRect,
 * Dimensions.get('window')) in the design px the page is laid out and drawn in.
 * The same object when the page is not zoomed.
 */
export function toDesignRect<T extends Partial<Record<'x' | 'y' | 'w' | 'h' | 'width' | 'height', number>>>(r: T): T {
  const z = pageZoom();
  if (z === 1) return r;
  const out: Record<string, unknown> = { ...r };
  for (const k of ['x', 'y', 'w', 'h', 'width', 'height'] as const) {
    const v = r[k];
    if (typeof v === 'number') out[k] = v / z;
  }
  return out as T;
}
