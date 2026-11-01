import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';

/** Anything that can say where it is on screen. */
type Measurable = { measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void };

const RevealContext = createContext<((node: Measurable | null) => void) | null>(null);

/**
 * A ScrollView that brings the box being typed in into view. On Android the
 * keyboard sometimes shrinks the page (and a bar lifted above it) and
 * sometimes just covers its lower part, so a field low on the page stays half
 * hidden. This looks at where the keyboard really starts: it adds as much room
 * at the bottom of the page as the keyboard covers, and a Field inside it
 * calls `useReveal` when it gets focus, so the page scrolls just far enough to
 * show the whole box with a small gap (plan task 1.8). On the web it does
 * nothing: the browser does this itself.
 */
export const KeyboardScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardScrollView(
  { children, onScroll, contentContainerStyle, ...rest },
  forwarded,
) {
  const inner = useRef<ScrollView>(null);
  const offset = useRef(0);
  // Where the keyboard's top edge is on screen, or null while it is closed.
  const keyboardTop = useRef<number | null>(null);
  // Room added at the bottom of the page: what the keyboard covers of this scroll view.
  const [pad, setPad] = useState(0);
  useImperativeHandle(forwarded, () => inner.current as ScrollView);
  // A ScrollView is a native view underneath; its type just does not list measureInWindow.
  const asMeasurable = () => inner.current as unknown as Measurable | null;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      timer = setTimeout(() => {
        const top = keyboardTop.current;
        if (top === null) return;
        asMeasurable()?.measureInWindow((_x, viewTop, _w, viewHeight) => {
          setPad(Math.max(0, Math.ceil(viewTop + viewHeight - top)));
        });
      }, 250);
    };
    const open = Keyboard.metrics();
    if (open) {
      keyboardTop.current = open.screenY;
      measure();
    }
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setPad(0);
      measure();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      if (timer) clearTimeout(timer);
      setPad(0);
    });
    return () => {
      if (timer) clearTimeout(timer);
      show.remove();
      hide.remove();
    };
  }, []);

  const reveal = useCallback((node: Measurable | null) => {
    if (Platform.OS === 'web' || !node) return;
    // Wait for the keyboard, the lifted bar and the extra room to settle, then measure where the box really is.
    setTimeout(() => {
      node.measureInWindow((_x, boxTop, _w, boxHeight) => {
        asMeasurable()?.measureInWindow((_sx, viewTop, _sw, viewHeight) => {
          const viewBottom = viewTop + viewHeight;
          const visibleBottom = keyboardTop.current === null ? viewBottom : Math.min(viewBottom, keyboardTop.current);
          const overflow = boxTop + boxHeight + 16 - visibleBottom;
          if (overflow > 0) inner.current?.scrollTo({ y: offset.current + overflow, animated: true });
        });
      });
    }, 600);
  }, []);

  const value = useMemo(() => reveal, [reveal]);
  const track = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };

  const own = StyleSheet.flatten(contentContainerStyle);
  const ownBottom = Number(own?.paddingBottom ?? own?.padding ?? 0) || 0;

  return (
    <RevealContext.Provider value={value}>
      <ScrollView
        ref={inner}
        {...rest}
        contentContainerStyle={pad > 0 ? [contentContainerStyle, { paddingBottom: ownBottom + pad }] : contentContainerStyle}
        onScroll={track}
        scrollEventThrottle={rest.scrollEventThrottle ?? 16}
      >
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
