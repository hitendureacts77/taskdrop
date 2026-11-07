import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { create } from 'qrcode/lib/core/qrcode';

// A QR code is read by cameras, so it is always black on white, in light and dark.
const DARK = '#000000';
const LIGHT = '#FFFFFF';
const QUIET = 4; // the blank border scanners need, in squares

/** One SVG path with a square for every dark module. */
function pathFor(value: string): { d: string; n: number } {
  const { modules } = create(value, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules.get(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    }
  }
  return { d, n: n + QUIET * 2 };
}

/** The code for `value`, drawn as crisp vector squares on a white tile. */
export function QrCode({ value, size, label }: { value: string; size: number; label?: string }) {
  const qr = useMemo(() => pathFor(value), [value]);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label ?? 'QR code'}
      style={{ width: size, height: size, borderRadius: 10, backgroundColor: LIGHT, overflow: 'hidden' }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${qr.n} ${qr.n}`}>
        <Path d={qr.d} fill={DARK} />
      </Svg>
    </View>
  );
}
