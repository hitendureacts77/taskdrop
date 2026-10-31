import { createContext, forwardRef, useCallback, useContext, useImperativeHandle, useMemo, useRef } from 'react';
import { Platform, ScrollView, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native';

/** Anything that can say where it is on screen. */
type Measurable = { measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void };

const RevealContext = createContext<((node: Measurable | null) => void) | null>(null);

/**
 * A ScrollView that brings the box being typed in into view. On Android the
 * page shrinks for the keyboard (and for a bar lifted above it), but a field
 * low on the page stays half hidden behind the bar or the keyboard. A Field
 * inside this scroll calls `useReveal` when it gets focus, and the page scrolls
 * just far enough to show the whole box with a small gap (plan task 1.8). On
 * the web it does nothing: the browser does this itself.
 */
export const KeyboardScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardScrollView(
  { children, onScroll, ...rest },
  forwarded,
) {
  const inner = useRef<ScrollView>(null);
  const offset = useRef(0);
  useImperativeHandle(forwarded, () => inner.current as ScrollView);

  const reveal = useCallback((node: Measurable | null) => {
    if (Platform.OS === 'web' || !node) return;
    // Wait for the keyboard and the lifted bar to settle, then measure where the box really is.
    setTimeout(() => {
      node.measureInWindow((_x, boxTop, _w, boxHeight) => {
        // A ScrollView is a native view underneath; its type just does not list measureInWindow.
        (inner.current as unknown as Measurable | null)?.measureInWindow((_sx, viewTop, _sw, viewHeight) => {
          const overflow = boxTop + boxHeight + 16 - (viewTop + viewHeight);
          if (overflow > 0) inner.current?.scrollTo({ y: offset.current + overflow, animated: true });
        });
      });
    }, 350);
  }, []);

  const value = useMemo(() => reveal, [reveal]);
  const track = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };

  return (
    <RevealContext.Provider value={value}>
      <ScrollView ref={inner} {...rest} onScroll={track} scrollEventThrottle={rest.scrollEventThrottle ?? 16}>
        {children}
      </ScrollView>
    </RevealContext.Provider>
  );
});

/** For a text box: call the result with the box's View when it gets focus. A no-op outside a KeyboardScrollView. */
export function useReveal(): (node: Measurable | null) => void {
  return useContext(RevealContext) ?? noop;
}

const noop = () => {};
