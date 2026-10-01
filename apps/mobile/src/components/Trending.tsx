import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import {
  platformHighlights,
  topEarners,
  trendingCategories,
  type Earner,
  type EarnerKind,
  type Highlights,
  type TrendingCategory,
} from '../data/extras';
import { Icon } from './Icon';
import { Pill, SectionTitle, Shimmer, rupees } from './kit';
import { categoryIcon } from './WorkCard';
import { tx } from './primitives';

/**
 * The "Trending" tab: which categories are busy, who is doing the work, and
 * how lively the marketplace is right now. Every number comes from the
 * database (migration 048's aggregates); nothing is illustrative.
 */
export function TrendingSection({ onCategory }: { onCategory?: (category: string) => void }) {
  const t = useTheme();
  const [cats, setCats] = useState<TrendingCategory[] | null>(null);
  const [kind, setKind] = useState<EarnerKind>('top_rated');
  const [earners, setEarners] = useState<Earner[] | null>(null);
  const [hl, setHl] = useState<Highlights | null>(null);

  useEffect(() => {
    let alive = true;
    trendingCategories(8)
      // A category with nothing open is not busy; leave it out.
      .then((r) => alive && setCats(r.filter((c) => c.open_count > 0)))
      .catch(() => alive && setCats([]));
    platformHighlights()
      .then((r) => alive && setHl(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setEarners(null);
    topEarners(kind, 10)
      .then((r) => alive && setEarners(r))
      .catch(() => alive && setEarners([]));
    return () => {
      alive = false;
    };
  }, [kind]);

  return (
    <View>
      <SectionTitle title="Busiest categories" icon="trending" badge="Today" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
        {cats === null
          ? [0, 1, 2, 3].map((i) => <Shimmer key={i} height={64} style={{ width: '47%' }} />)
          : cats.length === 0
            ? (
              <RNText style={tx('400', 13, t.colors.muted)}>Nothing trending yet — post the first task.</RNText>
            )
            : cats.map((c) => (
                <Pressable
                  key={c.category}
                  onPress={() => onCategory?.(c.category)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({
                    width: '47.5%',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    backgroundColor: t.colors.surface,
                    borderWidth: 1,
                    borderColor: t.colors.line,
                    borderRadius: 14,
                    padding: 12,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={categoryIcon(c.category)} size={17} color={t.colors.accentDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <RNText style={tx('700', 13, t.colors.ink)} numberOfLines={1}>{c.category}</RNText>
                    <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                      {c.open_count} open · ~{rupees(c.avg_budget_minor / 100)}
                    </RNText>
                  </View>
                </Pressable>
              ))}
      </View>

      <SectionTitle title="Most trusted workers" icon="trophy" style={{ marginTop: 26 }} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Pill label="Top rated" icon="star" active={kind === 'top_rated'} onPress={() => setKind('top_rated')} />
        <Pill label="Most active" icon="trending" active={kind === 'most_active'} onPress={() => setKind('most_active')} />
        <Pill label="New talent" icon="sparkle" active={kind === 'new_talent'} onPress={() => setKind('new_talent')} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -20 }}>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>
          {earners === null
            ? [0, 1, 2].map((i) => <Shimmer key={i} height={150} style={{ width: 130 }} />)
            : earners.length === 0
              ? (
                <RNText style={tx('400', 13, t.colors.muted)}>No one here yet.</RNText>
              )
              : earners.map((e) => <EarnerCard key={e.id} e={e} />)}
        </View>
      </ScrollView>

      <SectionTitle title="TaskDrop this week" icon="bolt" style={{ marginTop: 26 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, paddingVertical: 14 }}>
        {[
          { label: 'Active now', value: hl?.activeNow, color: t.colors.accentDeep },
          { label: 'Active today', value: hl?.activeToday, color: t.colors.purpleDeep },
          { label: 'Open tasks', value: hl?.openTasks, color: t.colors.blue },
          { label: 'Done today', value: hl?.completedToday, color: t.colors.goldInk },
        ].map((s) => (
          <View key={s.label} style={{ width: '25%', alignItems: 'center' }}>
            <RNText style={tx('800', 20, s.color)}>{s.value ?? '–'}</RNText>
            <RNText style={tx('500', 10, t.colors.muted, { marginTop: 3, textAlign: 'center' })}>{s.label}</RNText>
          </View>
        ))}
      </View>
    </View>
  );
}

function EarnerCard({ e }: { e: Earner }) {
  const t = useTheme();
  const { go } = useNav();
  const name = e.username ? '@' + e.username : e.display_name;
  return (
    <Pressable
      onPress={() => go('publicProfile', { userId: e.id })}
      accessibilityRole="button"
      accessibilityLabel={`View ${name}`}
      style={({ pressed }) => ({
        width: 130,
        alignItems: 'center',
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderRadius: 14,
        padding: 12,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ width: 46, height: 46, borderRadius: 999, backgroundColor: t.colors.purpleDeep, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={tx('800', 18, '#FFFFFF')}>{(e.display_name || '?').trim().charAt(0).toUpperCase()}</RNText>
      </View>
      <RNText style={tx('700', 12, t.colors.ink, { marginTop: 8 })} numberOfLines={1}>{name}</RNText>
      <RNText style={tx('600', 11, e.rating_count > 0 ? t.colors.goldInk : t.colors.muted, { marginTop: 3 })}>
        {e.rating_count > 0 ? `★ ${Number(e.rating).toFixed(1)} · ${e.rating_count} review${e.rating_count === 1 ? '' : 's'}` : 'New worker'}
      </RNText>
      <RNText style={tx('400', 10, t.colors.muted, { marginTop: 2 })}>
        {e.jobs_done} job{e.jobs_done === 1 ? '' : 's'} done
      </RNText>
      {e.skill ? (
        <View style={{ marginTop: 7, backgroundColor: t.colors.surface2, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
          <RNText style={tx('600', 10, t.colors.text)} numberOfLines={1}>{e.skill}</RNText>
        </View>
      ) : null}
      <View style={{ marginTop: 9, borderWidth: 1, borderColor: t.colors.line, borderRadius: 8, paddingVertical: 5, alignSelf: 'stretch', alignItems: 'center' }}>
        <RNText style={tx('700', 11, t.colors.accentDeep)}>View profile</RNText>
      </View>
    </Pressable>
  );
}
