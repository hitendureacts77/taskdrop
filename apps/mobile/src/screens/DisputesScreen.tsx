import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable } from 'react-native';
import { Screen, cardSurface } from '../components/ui';
import { Badge, EmptyState, Shimmer, StatTile, TopBar, rupees, timeAgo } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { listDisputeReasons, listMyDisputes } from '../data/extras';
import type { Task } from '../data/api';
import { useLayout } from '../lib/layout';
import { RowCard } from '../components/RowCard';
import { CONTENT_INSET } from '../navigation/DesktopPage';

/**
 * My disputes: tasks this person is party to that are in dispute right now.
 * Disputes are settled by the team (admin_resolve_dispute), so this page is
 * for knowing where things stand and reaching support about them.
 */
export function DisputesScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { userId } = useAuth();
  const { desktop } = useLayout();
  const [rows, setRows] = useState<Task[] | null>(null);
  const [reasons, setReasons] = useState<Map<string, { reason: string; mine: boolean }>>(new Map());

  useEffect(() => {
    let alive = true;
    listMyDisputes()
      .then(async (r) => {
        if (!alive) return;
        setRows(r);
        const found = await listDisputeReasons(r.map((x) => x.id)).catch(() => new Map());
        if (alive) setReasons(found);
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  const asPoster = (rows ?? []).filter((x) => x.poster_id === userId).length;

  const rowBody = (task: Task) => (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <RNText style={tx('700', 14, t.colors.ink, { flex: 1 })} numberOfLines={2}>{task.title}</RNText>
        <Badge label="With our team" tone="signal" />
      </View>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6 })}>
        {rupees((task.locked_minor ?? task.benchmark_minor) / 100)} · {task.poster_id === userId ? 'You posted this' : 'You worked on this'} · opened {timeAgo(task.updated_at)}
      </RNText>
      {reasons.get(task.id) ? (
        <RNText style={tx('400', 12, t.colors.ink, { marginTop: 8, lineHeight: 17 })}>
          {reasons.get(task.id)!.mine ? 'You said: ' : 'They said: '}
          {reasons.get(task.id)!.reason}
        </RNText>
      ) : null}
      <Pressable onPress={() => go('help')} style={{ marginTop: 10 }} accessibilityRole="button">
        <RNText style={tx('700', 13, t.colors.accentDeep)}>Add details for the team ›</RNText>
      </Pressable>
    </>
  );

  return (
    <Screen padded={false}>
      <TopBar title="My complaints" subtitle="Where each one stands" onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: desktop ? 8 : 0, paddingHorizontal: desktop ? CONTENT_INSET : 20, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <StatTile icon="gavel" label="Active" value={rows ? String(rows.length) : '–'} tone="signal" />
          <StatTile icon="list" label="On my posts" value={rows ? String(asPoster) : '–'} tone="gold" />
        </View>
        {rows === null ? (
          <Shimmer height={80} style={{ marginTop: 14 }} />
        ) : rows.length === 0 ? (
          <EmptyState icon="shield" title="No complaints" body="If something goes wrong on a task, report a problem from the task page. It will show up here." />
        ) : desktop ? (
          // Desktop: the complaints are rows on one card, not a card each.
          <View style={{ marginTop: 14 }}>
            <RowCard fill>
              {rows.map((task) => (
                <View key={task.id} style={{ padding: 16 }}>
                  {rowBody(task)}
                </View>
              ))}
            </RowCard>
          </View>
        ) : (
          rows.map((task) => (
            <View key={task.id} style={{ marginTop: 12, ...cardSurface(t, 18), padding: 14 }}>
              {rowBody(task)}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
