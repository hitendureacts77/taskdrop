import { memo, useState, type ReactNode } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import type { TaskWithPoster } from '../data/api';
import { Icon, type IconName } from './Icon';
import { Badge, rupees, timeLeft } from './kit';
import { FadeIn, Pressy, tx } from './primitives';
import { presenceOf } from '../lib/presence';
import { roughPlace } from '../lib/place';
import { cardSurface } from './ui';
import { TopUpBadge } from './TopUpBadge';
import { optionLabels } from './OptionBadges';
import { HuntTag } from './HuntTag';
import { huntLook } from '../data/api';
import { isHunt } from '../lib/hunt';

const CATEGORY_ICON: Record<string, IconName> = {
  'Home Services': 'home',
  'Repairs & Maintenance': 'settings',
  'Errands & Delivery': 'send',
  'Shopping & Sourcing': 'tag',
  'Local Checks & Info': 'pin',
  'Tech & Websites': 'compass',
  'Design & Creative': 'edit',
  'Writing & Content': 'edit',
  'Photo & Video': 'play',
  'Tutoring & Education': 'list',
  'Career & Resume': 'briefcase',
  'Business & Consulting': 'briefcase',
  'Events & Planning': 'gift',
  'Admin & Data Entry': 'list',
};

export function categoryIcon(category: string | null | undefined): IconName {
  return (category && CATEGORY_ICON[category]) || 'sparkle';
}

export function categoryLabel(task: { category?: string | null; pillar: string }): string {
  if (task.category) return task.category;
  return task.pillar === 'procurement' ? 'Products' : task.pillar === 'local_intel' ? 'Local Intel' : 'Services';
}

/**
 * A task as a worker browses it: what, how much, how long is left, who asked,
 * and the two things they can do from the list -- save it or apply.
 */
export const WorkCard = memo(function WorkCard({
  task,
  index = 0,
  saved,
  onOpen,
  onApply,
  onToggleSave,
  km,
}: {
  task: TaskWithPoster;
  index?: number;
  saved?: boolean;
  onOpen: () => void;
  onApply: () => void;
  onToggleSave?: () => void;
  /** Distance from the worker's area, when the list is sorted by it. */
  km?: number;
}) {
  const t = useTheme();
  const left = timeLeft(task.due_at);
  const rating =
    task.poster && task.poster.poster_rating_count > 0 ? Number(task.poster.poster_rating_avg).toFixed(1) : null;
  const live = task.flag === 'urgent';
  // City Hunt (D19): a gold tag, the time left to find it, and I'm looking instead of Apply.
  const hunt = isHunt(task);
  const [looking, setLooking] = useState(false);
  const lookThenOpen = async () => {
    if (looking) return;
    setLooking(true);
    try {
      await huntLook(task.id);
    } catch {
      /* the task page says why, and still lets them send a find */
    } finally {
      setLooking(false);
      onOpen();
    }
  };
  const presence = presenceOf(task.poster?.last_seen_at);

  // At most ONE tag, the most important: hunt, top offer, urgent, then the poster's options, difficulty, auto-hire.
  const option = optionLabels(task)[0];
  let tag: ReactNode = null;
  if (hunt) tag = <HuntTag task={task} />;
  else if (task.topup_pct && task.topup_pct > 0) tag = <TopUpBadge pct={task.topup_pct} compact />;
  else if (live) tag = <Badge label="Urgent" tone="signal" />;
  else if (option) tag = <Badge label={option.label} tone={option.tone} />;
  else if (task.difficulty) tag = <Badge label={task.difficulty} tone="blue" />;
  else if (task.assignment_mode === 'auto') tag = <Badge label="Auto-hire" tone="accent" />;

  const place =
    km !== undefined && Number.isFinite(km)
      ? (task.loc_label ? (roughPlace(task.loc_label) ?? '') + ' · ' : '') + (km < 1 ? '< 1 km' : `${km.toFixed(km < 10 ? 1 : 0)} km`)
      : task.loc_lat === null
        ? 'Remote'
        : task.loc_label
          ? (roughPlace(task.loc_label) ?? 'Area not shared')
          : '';
  const poster = task.poster?.username ? '@' + task.poster.username : (task.poster?.display_name ?? 'someone');
  const meta = [place, 'by ' + poster, rating ? '★ ' + rating : '', presence.label].filter(Boolean).join(' · ');

  return (
    <FadeIn duration={360} delay={Math.min(index, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
      <Pressy
        containsControls
        onPress={onOpen}
        scaleTo={0.985}
        style={[
          cardSurface(t),
          {
            // Fixed height: every card in a row is the same height (design D21).
            height: 176,
            gap: 8,
            // Urgent work keeps a coral edge, softened into the line.
            borderColor: live ? t.colors.signal : t.colors.line,
            padding: 16,
          },
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 }}>
          <Icon name={categoryIcon(task.category)} size={14} color={t.colors.accentDeep} strokeWidth={1.9} />
          <RNText style={tx('700', 11.5, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
            {categoryLabel(task)}
          </RNText>
          {tag}
          <View style={{ flex: 1 }} />
          {onToggleSave ? (
            <Pressable
              onPress={onToggleSave}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from saved' : 'Save for later'}
            >
              <Icon name="bookmark" size={18} color={saved ? t.colors.accentDeep : t.colors.muted} strokeWidth={saved ? 2.6 : 1.8} />
            </Pressable>
          ) : null}
        </View>
        <RNText style={tx('800', 15, t.colors.ink, { letterSpacing: -0.2, lineHeight: 20, height: 40 })} numberOfLines={2}>
          {task.title}
        </RNText>
        <RNText style={tx('600', 12, t.colors.muted)} numberOfLines={1}>
          {meta}
        </RNText>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <RNText style={tx('800', 20, t.colors.accentDeep, { fontVariant: ['tabular-nums'], letterSpacing: -0.3 })}>{rupees(task.benchmark_minor / 100)}</RNText>
          {left && !hunt ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
              <Icon name="clock" size={12} color={left === 'overdue' ? t.colors.signal : t.colors.gold} strokeWidth={2} />
              <RNText style={tx('700', 11.5, left === 'overdue' ? t.colors.signal : t.colors.goldInk)} numberOfLines={1}>{left}</RNText>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <Pressy
            onPress={hunt ? () => void lookThenOpen() : onApply}
            label={hunt ? `I’m looking for ${task.title}` : `Apply for ${task.title}`}
            style={{ backgroundColor: t.colors.btn, borderRadius: 999, height: 36, justifyContent: 'center', paddingHorizontal: 16 }}
          >
            <RNText style={tx('800', 13, t.colors.onBtn)}>{hunt ? 'I’m looking' : 'Apply'}</RNText>
          </Pressy>
        </View>
      </Pressy>
    </FadeIn>
  );
});
