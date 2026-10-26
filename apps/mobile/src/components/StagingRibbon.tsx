import { Text as RNText, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { STAGING_RIBBON } from '../lib/environment';
import { tx } from './primitives';

/**
 * The thin strip above every screen of the staging copy: "Staging: fake money
 * and fake data". AppGate puts it at the top of the column, so it takes its own
 * row (nothing sits under it, nothing is covered, every tap still lands) and it
 * is gone in production.
 *
 * Coral family: white on the deep coral in light (5:1), the deep tint's light
 * coral in dark (7:1). Static, so reduced motion has nothing to switch off.
 * `topInset` is the status-bar height on phones; that part keeps the page colour
 * so the status bar icons stay readable.
 */
export function StagingRibbon({ topInset }: { topInset: number }) {
  const t = useTheme();
  const c = t.colors;
  const bg = t.isDark ? c.signalSoft : c.signalDeep;
  const fg = t.isDark ? c.signalDeep : c.onAccent;
  return (
    <View style={{ backgroundColor: c.bg, paddingTop: topInset }}>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={STAGING_RIBBON}
        style={{
          backgroundColor: bg,
          borderBottomWidth: t.isDark ? 1 : 0,
          borderBottomColor: c.signal,
          minHeight: 24,
          paddingVertical: 4,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />
        <RNText numberOfLines={2} style={tx('700', 12, fg, { letterSpacing: 0.2, textAlign: 'center' })}>
          {STAGING_RIBBON}
        </RNText>
      </View>
    </View>
  );
}
