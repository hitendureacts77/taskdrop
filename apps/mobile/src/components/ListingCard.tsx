import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import type { Task, TaskWithPoster } from '../data/api';
import { Icon } from './Icon';
import { categoryIcon } from './WorkCard';
import { AvatarPresence, PresenceLabel } from './PresenceDot';
import { rupees } from './kit';
import { roughPlace } from '../lib/place';
import { Pressy, tx } from './primitives';
import { useRailItemWidth } from './Rail';
import { cardSurface } from './ui';

/** "3-day delivery", "Delivered in 1 day". */
export function deliveryLabel(minutes: number): string {
  const days = Math.max(1, Math.round(minutes / 1440));
  return days === 1 ? 'Delivers in ~1 day' : `Delivers in ~${days} days`;
}

/**
 * A worker's gig offer, the way a marketplace shows one: what they will do,
 * where the price starts, how fast they deliver. `owner` shows the worker's
 * own controls (edit); otherwise it shows who offers it and whether they're
 * around right now.
 */
export function ListingCard({
  task,
  owner,
  onPress,
  width,
}: {
  task: Task | TaskWithPoster;
  owner?: boolean;
  onPress: () => void;
  width?: number;
}) {
  const t = useTheme();
  const w = useRailItemWidth(width ?? 0) || width;
  const poster = 'poster' in task ? task.poster : null;
  const name = poster?.username ? '@' + poster.username : (poster?.display_name ?? 'A worker');
  const rating =
    poster && poster.worker_rating_count > 0 ? `★ ${Number(poster.worker_rating_avg).toFixed(1)} (${poster.worker_rating_count})` : 'New';

  return (
    <Pressy
      onPress={onPress}
      scaleTo={0.985}
      label={task.title}
      style={[cardSurface(t, 20), { width: w, overflow: 'hidden' }]}
    >
      {/* A band in the category's colour stands in for a cover image. */}
      <View style={{ height: 76, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', right: -40, top: -50, width: 160, height: 160, borderRadius: 999, backgroundColor: t.colors.surface2, opacity: 0.6 }} />
        <Icon name={categoryIcon(task.category)} size={26} color={t.colors.accentDeep} strokeWidth={1.6} />
        {!owner && task.loc_lat === null ? (
          <View style={{ position: 'absolute', top: 9, left: 10, height: 20, justifyContent: 'center', paddingHorizontal: 7, borderRadius: 6, backgroundColor: t.colors.surface }}>
            <RNText style={tx('800', 9, t.colors.aiInk, { letterSpacing: 0.9 })}>REMOTE</RNText>
          </View>
        ) : null}
        {owner ? (
          <View style={{ position: 'absolute', top: 8, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.colors.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: task.status === 'OPEN' ? t.colors.online : t.colors.muted }} />
            <RNText style={tx('700', 10, t.colors.ink)}>{task.status === 'OPEN' ? 'Live' : 'Hidden'}</RNText>
          </View>
        ) : null}
      </View>
      <View style={{ padding: 14 }}>
        {!owner && poster ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View>
              <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: t.colors.purpleDeep, alignItems: 'center', justifyContent: 'center' }}>
                <RNText style={tx('800', 11, '#FFFFFF')}>{(poster.display_name || '?').charAt(0).toUpperCase()}</RNText>
              </View>
              <AvatarPresence lastSeen={poster.last_seen_at} ring={t.colors.surface} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <RNText style={tx('700', 12, t.colors.ink)} numberOfLines={1}>{name}</RNText>
              <PresenceLabel lastSeen={poster.last_seen_at} />
            </View>
          </View>
        ) : null}
        <RNText style={tx('800', 15, t.colors.ink, { lineHeight: 20, letterSpacing: -0.2 })} numberOfLines={2}>
          {task.title}
        </RNText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <Icon name="clock" size={12} color={t.colors.muted} />
          <RNText style={tx('500', 11, t.colors.muted)} numberOfLines={1}>
            {deliveryLabel(task.time_limit_minutes)} · {roughPlace(task.loc_label) ?? 'Remote'}
          </RNText>
          {!owner ? <RNText style={tx('600', 11, t.colors.goldInk)}> · {rating}</RNText> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.colors.line }}>
          <RNText style={tx('500', 11, t.colors.muted)}>From </RNText>
          <RNText style={tx('800', 18, t.colors.ink, { flex: 1, fontVariant: ['tabular-nums'], letterSpacing: -0.3 })}>{rupees(task.benchmark_minor / 100)}</RNText>
          {owner ? (
            <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="edit" size={13} color={t.colors.accentDeep} />
              <RNText style={tx('700', 12, t.colors.accentDeep)}>Edit</RNText>
            </Pressable>
          ) : (
            <Icon name="chevronRight" size={16} color={t.colors.muted} />
          )}
        </View>
      </View>
    </Pressy>
  );
}
