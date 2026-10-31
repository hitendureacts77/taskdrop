import { useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Anything that can say where it is on screen: a View, an Animated.View. */
type Measurable = { measureInWindow: (cb: (x: number, y: number, width: number, height: number) => void) => void };

/**
 * Extra bottom margin that lifts something at the bottom of the screen (a
 * message box, a row of buttons, a pop-up, a toast) out from behind the
 * on-screen keyboard (Android only). The app already lifts every screen for the
 * keyboard (NativeRoot), but how far that gets depends on the phone and its
 * keyboard. This looks at where the thing really is once the keyboard has
 * settled and adds only what is still missing, so one that is already clear
 * gets 0 and nothing moves. Point `ref` at it and use the number as its
 * `marginBottom` (or add it to its `bottom`).
 *
 * `watch` re-measures when it changes while the keyboard is already open: pass
 * what makes the thing appear (the toast text), because no keyboard event
 * comes then. Most places should use `KeyboardSafe`, which does this for a
 * row of buttons or a message box.
 */
export function useKeyboardClearance(ref: RefObject<Measurable | null>, watch?: unknown): number {
  const [extra, setExtra] = useState(0);
  // Where the keyboard's top edge is on screen, or null while it is closed.
  const keyboardTop = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const settle = (tries: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const top = keyboardTop.current;
      if (top === null) return;
      ref.current?.measureInWindow((_x, y, _w, h) => {
        const hidden = y + h - top;
        if (hidden > 1) setExtra((e) => e + Math.ceil(hidden));
        // The first measure can land before the lift has finished: look again.
        if (tries > 1) settle(tries - 1);
      });
    }, 250);
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // Already open when this appears (a toast, a pop-up opened while typing).
    const open = Keyboard.metrics();
    if (open) {
      keyboardTop.current = open.screenY;
      settle(3);
    }
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setExtra(0);
      settle(3);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
      if (timer.current) clearTimeout(timer.current);
      setExtra(0);
    });
    return () => {
      if (timer.current) clearTimeout(timer.current);
      show.remove();
      hide.remove();
    };
    // settle only reads refs; it is meant to be the same function for the life of the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  useEffect(() => {
    if (Platform.OS !== 'android' || watch === undefined || keyboardTop.current === null) return;
    settle(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch]);

  return extra;
}
