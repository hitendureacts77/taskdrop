import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import { tx } from './primitives';

/**
 * "Topped up 5%": the poster added this share on top of their own price with
 * the top-up bar (migration 129). The price shown beside it already includes
 * it. Nothing is drawn for a task with no top-up.
 */
export function TopUpBadge({ pct, compact = false }: { pct: number | null | undefined; compact?: boolean }) {
  const t = useTheme();
  if (!pct) return null;
  return (
    <View
      accessibilityLabel={`Topped up ${pct} percent by the poster`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        alignSelf: 'flex-start',
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: t.colors.accentSoft,
      }}
    >
      <Icon name="trending" size={10} color={t.colors.accentDeep} strokeWidth={2.6} />
      <RNText style={tx('800', 10.5, t.colors.accentDeep, { fontVariant: ['tabular-nums'] })}>
        {compact ? `+${pct}%` : `topped up ${pct}%`}
      </RNText>
    </View>
  );
}
