import { useRef } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useKeyboardClearance } from '../lib/useKeyboardClearance';

/**
 * A row at the bottom of a screen (a message box, Back and Continue) that must
 * stay above the on-screen keyboard. It is a plain View that, on Android, adds
 * only the lift the keyboard still hides (see useKeyboardClearance) to its own
 * bottom margin. Use it for every such bar instead of writing a fix per screen
 * (plan task 1.8).
 */
export function KeyboardSafe({ children, style, ...rest }: ViewProps) {
  const ref = useRef<View>(null);
  const lift = useKeyboardClearance(ref);
  const own = Number(StyleSheet.flatten(style)?.marginBottom ?? 0) || 0;
  return (
    <View ref={ref} {...rest} style={lift > 0 ? [style, { marginBottom: own + lift }] : style}>
      {children}
    </View>
  );
}
