import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { presenceOf } from '../lib/presence';
import { tx } from './primitives';

/**
 * A green dot for someone active now, a hollow grey one for someone away --
 * with the words beside it unless `dotOnly`.
 */
export function PresenceDot({
  lastSeen,
  dotOnly = false,
  size = 8,
}: {
  lastSeen: string | null | undefined;
  dotOnly?: boolean;
  size?: number;
}) {
  const t = useTheme();
  const p = presenceOf(lastSeen);
  const dot = (
    <View
      accessibilityLabel={dotOnly ? p.label : undefined}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: p.online ? '#22C55E' : 'transparent',
        borderWidth: p.online ? 0 : 1.5,
        borderColor: t.colors.muted,
      }}
    />
  );
  if (dotOnly) return dot;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {dot}
      <RNText style={tx('600', 11, p.online ? '#16A34A' : t.colors.muted)} numberOfLines={1}>
        {p.label}
      </RNText>
    </View>
  );
}

/** A dot pinned to the corner of an avatar. */
export function AvatarPresence({ lastSeen, ring }: { lastSeen: string | null | undefined; ring: string }) {
  const p = presenceOf(lastSeen);
  return (
    <View
      accessibilityLabel={p.label}
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 13,
        height: 13,
        borderRadius: 999,
        backgroundColor: p.online ? '#22C55E' : '#9CA3AF',
        borderWidth: 2,
        borderColor: ring,
      }}
    />
  );
}
