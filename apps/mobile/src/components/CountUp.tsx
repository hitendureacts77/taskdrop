import { useEffect, useRef, useState } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { useReducedMotion } from '../lib/motion';

/**
 * A number that counts up to its value (SYS-Motion "the balance counts up"),
 * easing out over about a second. Reduce Motion shows the value at once.
 * `format` turns the in-between numbers into text, e.g. formatINR.
 */
export function CountUp({
  value,
  format,
  style,
  duration = 1100,
}: {
  value: number;
  format: (n: number) => string;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = from.current;
    const t0 = Date.now();
    let frame = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, duration]);
  return (
    <RNText style={style} accessibilityLabel={format(value)}>
      {format(shown)}
    </RNText>
  );
}
