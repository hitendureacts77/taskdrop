import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text as RNText, View, type ViewStyle } from 'react-native';
import { useActions } from '../providers/AppStateProvider';
import { useTheme } from '../providers/ThemeProvider';
import { listBlockedUsers, unblockUser, type BlockedUser } from '../data/api';
import { tx } from './primitives';

/**
 * The people you have blocked, with a way to undo it. A blocked person cannot
 * offer on your jobs and you no longer see theirs; work you already share
 * carries on. Shown under Account & settings → App.
 */
export function BlockedPeopleCard({ style }: { style?: ViewStyle }) {
  const t = useTheme();
  const { flash } = useActions();
  const [people, setPeople] = useState<BlockedUser[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPeople(await listBlockedUsers());
    } catch {
      setPeople([]); // the list is a convenience; never block the settings page on it
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unblock = async (p: BlockedUser) => {
    if (busyId) return;
    setBusyId(p.id);
    try {
      await unblockUser(p.id);
      setPeople((cur) => (cur ?? []).filter((x) => x.id !== p.id));
      flash(`${p.name} is unblocked`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not unblock');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={style}>
      <RNText style={tx('800', 15, t.colors.ink)}>Blocked people</RNText>
      <RNText style={tx('500', 13, t.colors.muted, { marginTop: 4 })}>
        They cannot offer on your jobs and you will not see theirs. Work you already share carries on.
      </RNText>
      {people === null ? null : people.length === 0 ? (
        <RNText style={tx('500', 13, t.colors.muted, { marginTop: 10 })}>You have not blocked anyone.</RNText>
      ) : (
        people.map((p, i) => (
          <View
            key={p.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 12,
              marginTop: i === 0 ? 6 : 0,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: t.colors.line,
            }}
          >
            <RNText style={tx('600', 14, t.colors.ink, { flex: 1, marginRight: 12 })} numberOfLines={1}>
              {p.name}
            </RNText>
            <Pressable
              onPress={() => void unblock(p)}
              disabled={busyId === p.id}
              accessibilityRole="button"
              accessibilityLabel={`Unblock ${p.name}`}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed || busyId === p.id ? 0.6 : 1 })}
            >
              <RNText style={tx('700', 13, t.colors.accentDeep)}>{busyId === p.id ? 'Working…' : 'Unblock'}</RNText>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}
