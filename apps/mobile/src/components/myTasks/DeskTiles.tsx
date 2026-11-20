import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { cardSurface } from '../ui';
import { tx } from '../primitives';

/**
 * The four tiles at the top of desktop My tasks (D31 v11, board WebMyTasks), in place of the phone's green
 * "Your tasks at a glance" card: Active, To review, Completed, and Needs providers, which is the same switch
 * as the phone's "Needs providers" pill (it shows only the open tasks nobody has offered on yet).
 */
export function DeskTiles({
  tiles,
  needs,
  needsOn,
  onNeeds,
}: {
  tiles: { label: string; value: string }[];
  /** How many open tasks have no offers; null while loading. */
  needs: number | null;
  needsOn: boolean;
  onNeeds: () => void;
}) {
  const t = useTheme();
  return (
    <View nativeID="myTasksTiles" style={{ flexDirection: 'row', gap: 14, marginBottom: 20 }}>
      {tiles.map((m) => (
        <View key={m.label} style={[cardSurface(t, 16), { flex: 1, paddingHorizontal: 18, paddingVertical: 16 }]}>
          <RNText style={tx('600', 13, t.colors.text)}>{m.label}</RNText>
          <RNText style={tx('800', 26, t.colors.ink, { marginTop: 4, letterSpacing: -0.6, fontVariant: ['tabular-nums'] })}>{m.value}</RNText>
        </View>
      ))}
      <Pressable
        onPress={onNeeds}
        disabled={!needs}
        accessibilityRole="button"
        accessibilityLabel={`Needs providers, ${needs ?? 0}`}
        accessibilityState={{ selected: needsOn, disabled: !needs }}
        style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [
          cardSurface(t, 16),
          {
            flex: 1,
            paddingHorizontal: 18,
            paddingVertical: 16,
            backgroundColor: needs ? t.colors.goldSoft : t.colors.surface,
            borderColor: needsOn ? t.colors.gold : needs ? t.colors.goldSoft : t.colors.line,
            borderWidth: needsOn ? 2 : 1,
            opacity: hovered && needs ? 0.92 : 1,
          },
        ]}
      >
        <RNText style={tx('600', 13, needs ? t.colors.goldInk : t.colors.text)}>Needs providers</RNText>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
          <RNText style={tx('800', 26, needs ? t.colors.goldInk : t.colors.ink, { letterSpacing: -0.6, fontVariant: ['tabular-nums'] })}>{needs === null ? '–' : String(needs)}</RNText>
          {needs ? <RNText style={tx('700', 13, t.colors.goldInk)}>{needsOn ? '· show all ›' : '· see them ›'}</RNText> : null}
        </View>
      </Pressable>
    </View>
  );
}
