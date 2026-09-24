import { useEffect, useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Screen, Text, Row, Button, Avatar, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { searchTasks, listMyBids, getProfile, attachPosters, type TaskWithPoster } from '../data/api';


/** Worker flow: quotes posters have sent on the worker's own service listing.
 * _design_source.jsx lines 749-767, markup at TaskDrop App.dc.html lines 847-882. */
export function MyQuotesScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { flash } = useApp();
  const { userId } = useAuth();
  const [picked, setPicked] = useState(0);
  const [rows, setRows] = useState<TaskWithPoster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      try {
        const [me, open, mine] = await Promise.all([
          getProfile(userId),
          searchTasks({ limit: 40, kind: 'request' }),
          listMyBids(userId),
        ]);
        if (!alive) return;

        const alreadyQuoted = new Set(mine.map((b) => b.task_id));
        const skills = (me?.skills ?? []).map((x) => x.toLowerCase());

        // Their own posts and anything already quoted on are not work to take.
        const candidates = open.filter((task) => task.poster_id !== userId && !alreadyQuoted.has(task.id));

        // Prefer skill matches, but never hide the rest behind an empty list.
        const matches = skills.length
          ? candidates.filter((task) =>
              skills.some(
                (sk) =>
                  task.title.toLowerCase().includes(sk) || task.description.toLowerCase().includes(sk),
              ),
            )
          : [];
        setRows(await attachPosters(matches.length ? matches : candidates));
      } catch (e) {
        if (alive) flash(e instanceof Error ? e.message : 'Could not load work for you');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const current = rows[picked] ?? rows[0] ?? null;

  const openIt = () => {
    if (!current) return;
    go('taskDetail', {
      row: {
        id: current.id,
        sponsored: false,
        who: current.poster?.display_name ?? 'Poster',
        rating:
          current.poster && current.poster.poster_rating_count > 0
            ? Number(current.poster.poster_rating_avg).toFixed(1)
            : 'new',
        whoMeta: current.loc_label ?? '',
        tag: 'SERVICES',
        title: current.title,
        meta: current.loc_label ?? '',
        amountMinor: current.benchmark_minor,
        hasMedia: false,
        glyph: '',
        dur: null,
        body: current.description,
        by: null,
      },
    });
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        <Pressable onPress={back} hitSlop={10} style={{ paddingTop: 8 }}>
          <Text variant="h2" color="muted">
            ←
          </Text>
        </Pressable>

        <Text variant="h1" style={{ marginTop: 16 }}>
          Work for you
        </Text>
        <Text color="muted" variant="body" style={{ marginTop: 8, lineHeight: 21, marginBottom: 4 }}>
          Open requests that match your skills and you haven't quoted on yet.
        </Text>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
          {!loading && rows.length === 0 && (
            <Text color="muted" variant="body" style={{ marginTop: 24, lineHeight: 21 }}>
              Nothing open matches your skills right now. Add more skills in your
              profile, or browse the whole feed.
            </Text>
          )}

          {rows.map((row, i) => {
            const selected = i === picked;
            const poster = row.poster;
            const rated = poster && poster.poster_rating_count > 0;
            return (
              <Pressable
                key={row.id}
                onPress={() => setPicked(i)}
                style={{
                  backgroundColor: selected ? t.colors.accentSoft : t.colors.surface,
                  borderWidth: 1,
                  borderColor: selected ? t.colors.accent : t.colors.line,
                  borderRadius: t.radius.lg,
                  padding: 14,
                  marginTop: 12,
                }}
              >
                <Row gap={11} align="center">
                  <Avatar name={poster?.display_name ?? 'Poster'} size={36} />
                  <View style={{ flex: 1 }}>
                    <Row gap={7} align="center">
                      <Text variant="h3">{poster?.display_name ?? 'Poster'}</Text>
                      <Text color="muted" variant="caption">
                        {rated ? '★ ' + Number(poster.poster_rating_avg).toFixed(1) : 'new here'}
                      </Text>
                    </Row>
                    <Text color="muted" variant="caption" style={{ marginTop: 3 }}>
                      {row.loc_label ?? 'Location not shared'}
                    </Text>
                  </View>
                  <Text variant="h3">{formatINR(row.benchmark_minor)}</Text>
                </Row>
                <Text variant="body" style={{ color: t.colors.text, marginTop: 11, lineHeight: 20 }}>
                  {row.title}
                </Text>
                {selected && (
                  <Row
                    gap={7}
                    align="center"
                    style={{
                      marginTop: 11,
                      paddingTop: 11,
                      borderTopWidth: 1,
                      borderTopColor: t.colors.accentBorder,
                    }}
                  >
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: t.colors.accent }} />
                    <Text variant="label" style={{ color: t.colors.accentDeep, letterSpacing: 1 }}>
                      SELECTED
                    </Text>
                  </Row>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={{ paddingTop: 14, paddingBottom: 24 }}>
        <Button
          label={current ? `Quote on this · ${formatINR(current.benchmark_minor)}` : 'Nothing to quote on'}
          onPress={openIt}
        />
        <Text color="muted" variant="caption" style={{ textAlign: 'center', marginTop: 10, lineHeight: 18 }}>
          The poster picks a quote; escrow is funded before you start.
        </Text>
      </View>
    </Screen>
  );
}
