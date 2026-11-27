import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';

/**
 * Row 2 of every tab (plan 1.19, "the same header on every tab"): the tab's name, one live line (counts that
 * change) and at most one action on the right. Row 1 (wordmark, Hire/Earn switch, bell, messages, face) is
 * AppHeader and is the same everywhere.
 */
export function TabTitle({
  title,
  live,
  dot = false,
  action,
}: {
  title: string;
  /** The one live line: counts that change. Left out, only the name shows. */
  live?: string | null;
  /** A small green dot before the line, for what is happening right now. */
  dot?: boolean;
  /** At most one: a button, a switch or an icon. */
  action?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText accessibilityRole="header" style={tx('800', 26, t.colors.ink, { letterSpacing: -0.7, lineHeight: 29 })} numberOfLines={1}>
          {title}
        </RNText>
        {live ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0, maxWidth: '100%' }}>
            {dot ? <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: t.colors.online }} /> : null}
            <RNText style={tx('500', 12.5, t.colors.muted, { flexShrink: 1, minWidth: 0, fontVariant: ['tabular-nums'] })} numberOfLines={1}>
              {live}
            </RNText>
          </View>
        ) : null}
      </View>
      {action ?? null}
    </View>
  );
}
