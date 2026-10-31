import { useEffect, useState, type RefObject } from 'react';
import { Keyboard, Platform, type View } from 'react-native';

/**
 * Extra bottom margin that lifts a bar at the bottom of the screen (a message
 * box) out from behind the on-screen keyboard (Android only). The app already
 * lifts every screen for the keyboard (NativeRoot), but on some phones that
 * falls short. This looks at where the bar really is once the keyboard has
 * settled and adds only what is still missing, so a screen that is already
 * clear gets 0 and nothing moves. Point `ref` at the bar and use the number as
 * its `marginBottom`.
 */
export function useKeyboardClearance(ref: RefObject<View | null>): number {
  const [extra, setExtra] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (keyboardTop: number, tries: number) => {
      timer = setTimeout(() => {
        ref.current?.measureInWindow((_x, y, _w, h) => {
          const hidden = y + h - keyboardTop;
          if (hidden > 1) setExtra((e) => e + Math.ceil(hidden));
          // The first measure can land before the lift has finished: look again.
          if (tries > 1) settle(keyboardTop, tries - 1);
        });
      }, 250);
    };
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      if (timer) clearTimeout(timer);
      setExtra(0);
      settle(e.endCoordinates.screenY, 3);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      if (timer) clearTimeout(timer);
      setExtra(0);
    });
    return () => {
      if (timer) clearTimeout(timer);
      show.remove();
      hide.remove();
    };
  }, [ref]);
  return extra;
}
