import { memo } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import type { TaskWithPoster } from '../data/api';
import { Icon, type IconName } from './Icon';
import { Badge, rupees, timeAgo, timeLeft } from './kit';
import { FadeIn, Pressy, tx } from './primitives';

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
}: {
  task: TaskWithPoster;
  index?: number;
  saved?: boolean;
  onOpen: () => void;
  onApply: () => void;
  onToggleSave?: () => void;
}) {
  const t = useTheme();
  const left = timeLeft(task.due_at);
  const rating =
    task.poster && task.poster.poster_rating_count > 0 ? Number(task.poster.poster_rating_avg).toFixed(1) : null;
  const live = task.flag === 'urgent';

  return (
    <FadeIn duration={360} delay={Math.min(index, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
      <Pressy
        containsControls
        onPress={onOpen}
        scaleTo={0.985}
        style={{
          flexDirection: 'row',
          gap: 12,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: live ? t.colors.signal : t.colors.line,
          borderRadius: 14,
          padding: 13,
        }}
      >
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            backgroundColor: t.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={categoryIcon(task.category)} size={22} color={t.colors.accentDeep} strokeWidth={1.7} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <RNText style={tx('600', 11, t.colors.muted)} numberOfLines={1}>
              {categoryLabel(task)}
            </RNText>
            <Badge label={task.assignment_mode === 'auto' ? 'Auto' : 'Bid'} tone={task.assignment_mode === 'auto' ? 'accent' : 'neutral'} />
            {task.difficulty ? <Badge label={task.difficulty} tone="blue" /> : null}
            {live ? <Badge label="Live" tone="signal" /> : null}
            <View style={{ flex: 1 }} />
            {onToggleSave ? (
              <Pressable
                onPress={onToggleSave}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={saved ? 'Remove from saved' : 'Save for later'}
              >
                <Icon name="bookmark" size={18} color={saved ? t.colors.accent : t.colors.muted} strokeWidth={saved ? 2.6 : 1.8} />
              </Pressable>
            ) : null}
          </View>
          <RNText style={tx('700', 15, t.colors.ink, { marginTop: 5 })} numberOfLines={2}>
            {task.title}
          </RNText>
          {task.description ? (
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 17 })} numberOfLines={2}>
              {task.description.replace(/\n+/g, ' ')}
            </RNText>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 }}>
            <RNText style={tx('800', 16, t.colors.accentDeep)}>{rupees(task.benchmark_minor / 100)}</RNText>
            {left ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="clock" size={12} color={left === 'overdue' ? t.colors.signal : t.colors.gold} strokeWidth={2} />
                <RNText style={tx('600', 11, left === 'overdue' ? t.colors.signal : t.colors.goldInk)}>{left}</RNText>
              </View>
            ) : null}
            {task.loc_label ? (
              <RNText style={tx('400', 11, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
                {task.loc_label.split(',').slice(-2).join(',').trim()}
              </RNText>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 9 }}>
            <RNText style={tx('400', 11, t.colors.muted, { flex: 1 })} numberOfLines={1}>
              by {task.poster?.username ? '@' + task.poster.username : (task.poster?.display_name ?? 'someone')}
              {rating ? ` · ★ ${rating}` : ''} · {timeAgo(task.created_at)}
            </RNText>
            <Pressy
              onPress={onApply}
              style={{ backgroundColor: t.colors.purpleDeep, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16 }}
            >
              <RNText style={tx('700', 12, '#FFFFFF')}>Apply</RNText>
            </Pressy>
          </View>
        </View>
      </Pressy>
    </FadeIn>
  );
});
