import { useEffect, useRef } from 'react';
import { View, Text as RNText, Pressable, Animated, Easing, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { onHero } from '../theme';
import { useReducedMotion, LOOP_NATIVE } from '../lib/motion';
import type { NearbyPulse, TrendingCategory } from '../data/extras';
import type { Task } from '../data/api';
import { roughPlace, pickedPlaceName } from '../lib/place';
import { Icon } from './Icon';
import { BottomSheet, rupees, timeAgo } from './kit';
import { categoryIcon } from './WorkCard';
import { cardSurface } from './ui';
import { tx } from './primitives';

/**
 * Home's live parts (task 1.19 F and I, "Alive, gently"): the live dot with its soft ring, the live pill in the area
 * row, the live sheet (Just posted in full and Busy on TaskDrop), the "1 new" pop and the chips' cross-fade. Every
 * movement here stops under Reduce Motion; the numbers come from reads Home already makes.
 */

/** A green "live" dot; a soft ring grows out of it every motion.liveRing ms. Still under Reduce Motion. */
export function LiveDot({ size = 8, color }: { size?: number; color?: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const ring = useRef(new Animated.Value(0)).current;
  const fill = color ?? t.colors.online;
  useEffect(() => {
    ring.setValue(0);
    if (reduced) return;
    // The ring takes about half the beat to grow and fade; the rest of the beat is still.
    const grow = Math.round(t.motion.liveRing * 0.55);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: grow, easing: Easing.out(Easing.quad), useNativeDriver: LOOP_NATIVE }),
        Animated.delay(t.motion.liveRing - grow),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ring, reduced, t.motion.liveRing]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      {reduced ? null : (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: 999,
            backgroundColor: fill,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          }}
        />
      )}
      <View style={{ width: size, height: size, borderRadius: 999, backgroundColor: fill }} />
    </View>
  );
}

/** The pill beside the area: a live dot and one real number. Tapping it opens the live sheet. */
export function LivePill({ text, onPress, label }: { text: string; onPress?: () => void; label?: string }) {
  const t = useTheme();
  const body = (
    <>
      <LiveDot size={7} />
      <RNText style={tx('700', 12, t.colors.ink, { fontVariant: ['tabular-nums'], flexShrink: 1 })} numberOfLines={1}>
        {text}
      </RNText>
    </>
  );
  const box = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 7, paddingHorizontal: 11, height: 30, borderRadius: 999, backgroundColor: t.colors.accentSoft, borderWidth: 1, borderColor: t.colors.accentBorder, flexShrink: 1, maxWidth: 210 };
  if (!onPress) return <View style={box}>{body}</View>;
  return (
    <Pressable
      testID="home-live-pill"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? `${text}. Opens what is live near you`}
      hitSlop={6}
      style={({ pressed }) => [box, { opacity: pressed ? 0.75 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** A coral "N new" badge that pops once (scale 0.7 to 1, motion.pop ms) when it first shows. Still under Reduce Motion. */
export function NewBadge({ count }: { count: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      pop.setValue(1);
      return;
    }
    pop.setValue(0);
    const anim = Animated.spring(pop, { toValue: 1, friction: t.motion.spring.friction, tension: t.motion.spring.tension, useNativeDriver: true });
    const cap = setTimeout(() => pop.setValue(1), t.motion.pop);
    anim.start();
    return () => {
      clearTimeout(cap);
      anim.stop();
    };
  }, [pop, reduced, count, t.motion]);
  if (count <= 0) return null;
  return (
    <Animated.View
      accessibilityLabel={`${count} new`}
      style={{
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
        backgroundColor: t.colors.signalFill,
        opacity: pop.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
        transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
      }}
    >
      <RNText style={tx('800', 10.5, onHero.text)}>{count} new</RNText>
    </Animated.View>
  );
}

/** Cards under a row of chips: a 250 ms fade (motion.ui) each time the chip changes. Nothing moves under Reduce Motion. */
export function ChipFade({ chip, children }: { chip: string; children: React.ReactNode }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    const anim = Animated.timing(fade, { toValue: 1, duration: t.motion.ui, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [chip, fade, reduced, t.motion.ui]);
  return <Animated.View style={{ opacity: fade }}>{children}</Animated.View>;
}

/** One chip of a chip row (Ideas to post, Jobs for you): the mode's filled pair when on. */
export function Chip({ label, on, onPress, count, testID }: { label: string; on: boolean; onPress: () => void; count?: number; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={count ? `${label}, ${count}` : label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        paddingHorizontal: 14,
        height: 36,
        borderWidth: 1.5,
        // The filled-button pair (B174): white on light jade in dark was 1.89:1.
        borderColor: on ? t.colors.btn : t.colors.accentBorder,
        backgroundColor: on ? t.colors.btn : 'transparent',
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <RNText style={tx('700', 13, on ? t.colors.onBtn : t.colors.accentDeep)}>{label}</RNText>
      {count ? (
        <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.signalFill }}>
          <RNText style={tx('800', 10.5, onHero.text, { fontVariant: ['tabular-nums'] })}>{count}</RNText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** A row of chips that scrolls sideways. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }}>
      {children}
    </ScrollView>
  );
}

/** A bar that grows to its value on view (Busy on TaskDrop). Full at once under Reduce Motion. */
function Bar({ pct, delay }: { pct: number; delay: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const grow = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return grow.setValue(1);
    const anim = Animated.timing(grow, { toValue: 1, duration: 700, delay: 120 + delay, easing: Easing.bezier(0.65, 0, 0.35, 1), useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [grow, reduced, delay]);
  const width = grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.max(0, Math.min(100, pct))}%`] });
  return (
    <View style={{ height: 6, borderRadius: 999, backgroundColor: t.colors.surface2, marginTop: 7, overflow: 'hidden' }}>
      <Animated.View style={{ height: 6, borderRadius: 999, width, backgroundColor: t.colors.accent, opacity: 0.9 }} />
    </View>
  );
}

function SheetHead({ title, sub }: { title: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 18 }}>
      <RNText accessibilityRole="header" style={tx('800', 15, t.colors.ink, { flex: 1 })}>
        {title}
      </RNText>
      {sub ? <RNText style={tx('500', 12, t.colors.muted)}>{sub}</RNText> : null}
    </View>
  );
}

/**
 * The live sheet behind the pill (Hire Home): the two live numbers, every task just posted (tap one to post one
 * like it) and what is busy on TaskDrop (tap a category to post in it). Busy now is also on Explore's list.
 */
export function LiveSheet({
  visible,
  onClose,
  place,
  pulse,
  helpersWithin,
  posted,
  trending,
  onPostLike,
  onBusy,
}: {
  visible: boolean;
  onClose: () => void;
  place: string | null;
  pulse: NearbyPulse | null;
  /** How many helpers the "active now" figure is out of (the helpers card's own count and distance). */
  helpersWithin?: { n: number; km: number } | null;
  posted: Task[];
  trending: TrendingCategory[];
  onPostLike: (title: string) => void;
  onBusy: (c: TrendingCategory) => void;
}) {
  const t = useTheme();
  const area = place ? pickedPlaceName(place) : null;
  const rows = posted.filter((r) => r.title.trim().length > 0);
  const busiest = Math.max(1, ...trending.map((c) => c.open_count));
  const stat = (n: number, words: string, live = false) => (
    <View style={[cardSurface(t, 16), { flex: 1, padding: 12, shadowOpacity: 0, elevation: 0 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <RNText style={tx('800', 22, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{n}</RNText>
        {live ? <LiveDot /> : null}
      </View>
      <RNText style={tx('500', 12, t.colors.muted)}>{words}</RNText>
    </View>
  );
  const row = (key: string, first: boolean, onPress: () => void, label: string, body: React.ReactNode) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: first ? 0 : 1, borderTopColor: t.colors.line, opacity: pressed ? 0.75 : 1 })}
    >
      {body}
    </Pressable>
  );
  return (
    <BottomSheet visible={visible} onClose={onClose} title={area ? `Live near ${area}` : 'Live on TaskDrop'}>
      <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
        {pulse && (pulse.doneToday > 0 || pulse.activeNow > 0) ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {stat(pulse.doneToday, 'done near you today')}
            {stat(pulse.activeNow, helpersWithin ? `active now, of ${helpersWithin.n} ${helpersWithin.n === 1 ? 'helper' : 'helpers'} within ${helpersWithin.km} km` : pulse.activeNow === 1 ? 'helper active now' : 'helpers active now', true)}
          </View>
        ) : null}

        {rows.length > 0 ? (
          <>
            <SheetHead title="Just posted" sub="Tap one to post one like it" />
            {rows.map((r, i) => {
              const meta = [r.loc_lat === null ? 'Remote' : roughPlace(r.loc_label), timeAgo(r.created_at)].filter(Boolean).join(' · ');
              return row(
                r.id,
                i === 0,
                () => {
                  onClose();
                  onPostLike(r.title);
                },
                r.title,
                <>
                  <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={categoryIcon(r.category ?? '')} size={16} color={t.colors.accentDeep} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={2}>
                      {r.title}
                    </RNText>
                    {meta ? <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })}>{meta}</RNText> : null}
                  </View>
                  {r.benchmark_minor > 0 ? (
                    <RNText style={tx('800', 14, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{rupees(r.benchmark_minor / 100)}</RNText>
                  ) : null}
                </>,
              );
            })}
          </>
        ) : null}

        {trending.length > 0 ? (
          <>
            <SheetHead title="Busy on TaskDrop" />
            {trending.map((c, i) =>
              row(
                c.category,
                i === 0,
                () => {
                  onClose();
                  onBusy(c);
                },
                `${c.category}. ${c.open_count} open, about ${rupees(c.avg_budget_minor / 100)} a task`,
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <RNText style={tx('700', 14, t.colors.ink, { flexShrink: 1 })} numberOfLines={1}>
                      {c.category}
                    </RNText>
                    <RNText style={tx('500', 12, t.colors.muted, { fontVariant: ['tabular-nums'] })}>
                      {c.open_count} open · ~{rupees(c.avg_budget_minor / 100)}
                    </RNText>
                  </View>
                  <Bar pct={Math.max(8, Math.round((c.open_count / busiest) * 100))} delay={i * 90} />
                </View>,
              ),
            )}
          </>
        ) : null}

        {rows.length === 0 && trending.length === 0 ? (
          <RNText style={tx('500', 13, t.colors.muted, { marginTop: 8, lineHeight: 19 })}>
            Nothing new around here yet. Post what you need and helpers nearby and online see it.
          </RNText>
        ) : null}
        <View style={{ height: 12 }} />
      </ScrollView>
    </BottomSheet>
  );
}

/** The live card at the top of the desktop rail: done today and helpers active now, from the same pulse. */
export function LiveRailCard({ place, pulse, helpersWithin, onOpen }: { place: string | null; pulse: NearbyPulse | null; helpersWithin?: { n: number; km: number } | null; onOpen: () => void }) {
  const t = useTheme();
  const area = place ? pickedPlaceName(place) : null;
  return (
    <Pressable
      testID="home-live-card"
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Live near ${area ?? 'you'}. Opens Just posted and Busy on TaskDrop`}
      style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [cardSurface(t, 16), { padding: 16, backgroundColor: hovered ? t.colors.surface2 : t.colors.surface }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <LiveDot />
        <RNText accessibilityRole="header" style={tx('800', 14.5, t.colors.accentDeep, { flex: 1 })} numberOfLines={1}>
          {area ? `Live near ${area}` : 'Live on TaskDrop'}
        </RNText>
      </View>
      <View style={{ flexDirection: 'row', gap: 18, marginTop: 8 }}>
        <View>
          <RNText style={tx('800', 22, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{pulse ? pulse.doneToday : '–'}</RNText>
          <RNText style={tx('500', 12, t.colors.muted)}>done today</RNText>
        </View>
        <View>
          <RNText style={tx('800', 22, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{pulse ? pulse.activeNow : '–'}</RNText>
          <RNText style={tx('500', 12, t.colors.muted)}>{helpersWithin ? `active now, of ${helpersWithin.n} within ${helpersWithin.km} km` : 'active now'}</RNText>
        </View>
      </View>
    </Pressable>
  );
}
