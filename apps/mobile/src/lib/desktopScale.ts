/**
 * The desktop page scale lives only in the web build (desktopScale.web.ts).
 * Android and iOS never zoom: nothing to do here.
 */
export function useDesktopScale(): void {}

/** Android and iOS are never zoomed. */
export function pageZoom(): number {
  return 1;
}

/** Android and iOS are never zoomed: measured px are already design px. */
export function toDesignRect<T extends Partial<Record<'x' | 'y' | 'w' | 'h' | 'width' | 'height', number>>>(r: T): T {
  return r;
}
