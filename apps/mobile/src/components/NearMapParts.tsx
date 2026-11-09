import { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput, type ScrollViewInstance, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import type { TaskWithPoster } from '../data/api';
import type { MapPerson, NearbyWorker } from '../data/extras';
import { presenceOf } from '../lib/presence';
import { areaName, farText, firstName, initialsOf, offerOf, togetherText } from './mapPins';
import { mapWords, type MapTone } from './JobsMap';
import { TopUpBadge } from './TopUpBadge';
import { categoryIcon } from './WorkCard';
import { Icon } from './Icon';
import { rupees } from './kit';
import { Pressy, tx } from './primitives';

/**
 * The pieces of the full map's side panel (desktop) and bottom sheet (phone),
 * plan D14: the list lives here, so nothing sits across the bottom of the map.
 */

export type MapJob = TaskWithPoster & { km: number; fresh: boolean };

/** Each list row is this tall, so the list can scroll a picked row into view. */
export const ROW_H = 64;
export const ROW_GAP = 4;

/** The colours of one side: jobs in the mode's accent, helpers in the Earn blue (as on the map). */
export function useTone(tone: MapTone) {
  const t = useTheme();
  return tone === 'people'
    ? { hue: t.colors.purple, soft: t.colors.purpleSoft, ink: t.colors.purpleDeep, border: t.colors.purple }
    : { hue: t.colors.accent, soft: t.colors.accentSoft, ink: t.colors.accentDeep, border: t.colors.accentBorder };
}

/** Best offer and nearest (jobs), active now and nearest (helpers): two tiles that pick or filter. */
export function StatTiles({
  tiles,
  tone,
  summary,
}: {
  tiles: { label: string; value: string; sub: string; strong?: boolean; onPress?: () => void }[];
  tone: MapTone;
  /** One sentence that says what both tiles say, for screen readers. */
  summary?: string;
}) {
  const t = useTheme();
  const c = useTone(tone);
  return (
    <View accessibilityLabel={summary} style={{ flexDirection: 'row', gap: 8 }}>
      {tiles.map((s) => (
        <Pressy
          key={s.label}
          onPress={s.onPress}
          label={`${s.label}: ${s.value}, ${s.sub}`}
          scaleTo={0.97}
          style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, gap: 2, backgroundColor: s.strong ? c.soft : t.colors.surface2, borderWidth: 1, borderColor: s.strong ? c.border : t.colors.line }}
        >
          <RNText style={tx('700', 11, s.strong ? c.ink : t.colors.muted)} numberOfLines={1}>
            {s.label}
          </RNText>
          <RNText style={tx('800', 18, t.colors.ink, { fontVariant: ['tabular-nums'] })} numberOfLines={1}>
            {s.value}
          </RNText>
          <RNText style={tx('600', 11, t.colors.text)} numberOfLines={1}>
            {s.sub}
          </RNText>
        </Pressy>
      ))}
    </View>
  );
}

/** A row of choices in one pill (the 5 / 10 / 25 km reach, the Jobs / Best-paying areas tabs). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  grow = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  grow?: boolean;
}) {
  const t = useTheme();
  return (
    <View accessibilityLabel={label} style={{ flexDirection: 'row', padding: 3, borderRadius: 14, backgroundColor: t.colors.surface2, alignSelf: grow ? 'stretch' : 'auto' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ flex: grow ? 1 : undefined, height: grow ? 34 : 28, paddingHorizontal: 11, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.colors.line : 'transparent' }}
          >
            <RNText style={tx(on ? '800' : '700', 12, on ? t.colors.ink : t.colors.muted)} numberOfLines={1}>
              {o.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** What the "My people" layer says about a pin (plan D20): a spot is a rounded cell, and it expires. */
export const MINE_WORDS = {
  privacy: 'Spots are rounded to about 500 m and vanish after 15 minutes.',
  legend: 'Tap a face to see who',
  one: 'person',
  many: 'people',
} as const;

/**
 * The two notes that used to sit over the map: privacy, and what a pin means.
 * `mine` swaps in the "My people" words (still the blue people look).
 */
export function MapNotes({ tone, legend = true, mine = false }: { tone: MapTone; legend?: boolean; mine?: boolean }) {
  const t = useTheme();
  const c = useTone(tone);
  const words = mine ? { ...mapWords(tone), ...MINE_WORDS } : mapWords(tone);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="lock" size={12} color={c.ink} />
        <RNText style={tx('600', 11.5, t.colors.muted, { flexShrink: 1 })}>{words.privacy}</RNText>
      </View>
      {legend ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {tone === 'people' ? (
            <Icon name="users" size={12} color={c.ink} />
          ) : (
            <View style={{ width: 16, height: 10, borderRadius: 5, backgroundColor: t.colors.ink }} />
          )}
          <RNText style={tx('600', 11.5, t.colors.muted, { flexShrink: 1 })}>{words.legend}</RNText>
        </View>
      ) : null}
    </View>
  );
}

function IconTile({ name, tone, size = 40 }: { name: React.ComponentProps<typeof Icon>['name']; tone: MapTone; size?: number }) {
  const c = useTone(tone);
  return (
    <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={18} color={c.ink} />
    </View>
  );
}

function JustPosted({ tone }: { tone: MapTone }) {
  const c = useTone(tone);
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: c.soft }}>
      <RNText style={tx('800', 10, c.ink)}>Just posted</RNText>
    </View>
  );
}

/** "Madhapur · under 1 km · by Ravi". */
export function jobMeta(j: MapJob): string {
  return `${areaName(j.loc_label)} · ${farText(j.km)}${j.poster ? ` · by ${firstName(j.poster.display_name || j.poster.username)}` : ''}`;
}

/** One job in the list. The picked one is outlined; tapping a row flies the map to it. */
export function JobRow({ job: j, on, onPress }: { job: MapJob; on: boolean; onPress: () => void }) {
  const t = useTheme();
  const c = useTone('jobs');
  const price = rupees(j.benchmark_minor / 100);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${j.title}, ${price}, ${jobMeta(j)}${j.fresh ? ', just posted' : ''}`}
      style={({ pressed }) => ({
        height: ROW_H,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 10,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: on ? c.hue : 'transparent',
        backgroundColor: on ? c.soft : pressed ? t.colors.surface2 : 'transparent',
      })}
    >
      <IconTile name={categoryIcon(j.category ?? '')} tone="jobs" />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <RNText style={tx('700', 13.5, t.colors.ink)} numberOfLines={1}>
          {j.title}
        </RNText>
        <RNText style={tx('600', 11.5, t.colors.muted)} numberOfLines={1}>
          {jobMeta(j)}
        </RNText>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <RNText style={tx('800', 15, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{price}</RNText>
        {j.fresh ? <JustPosted tone="jobs" /> : <TopUpBadge pct={j.topup_pct} compact />}
      </View>
    </Pressable>
  );
}

export type MapArea = { name: string; top: MapJob; count: number; km: number };

/** One area in "Best-paying areas": its biggest offer against the best one, and how many tasks. */
export function AreaRow({ area: a, best, first, onPress }: { area: MapArea; best: number; first: boolean; onPress: () => void }) {
  const t = useTheme();
  const c = useTone('jobs');
  const price = rupees(a.top.benchmark_minor / 100);
  const tasks = `${a.count} ${a.count === 1 ? 'job' : 'jobs'}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a.name}, biggest offer ${price}, ${tasks}, ${farText(a.km)}`}
      style={({ pressed }) => ({ height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: 16, backgroundColor: pressed ? t.colors.surface2 : 'transparent' })}
    >
      
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <RNText style={tx('700', 13.5, t.colors.ink, { flexShrink: 1 })} numberOfLines={1}>
            {a.name}
          </RNText>
          <RNText style={tx('600', 11.5, t.colors.muted)} numberOfLines={1}>
            {tasks} · {farText(a.km)}
          </RNText>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.line, overflow: "hidden" }}>
          <View style={{ width: `${Math.round((100 * a.top.benchmark_minor) / (best || 1))}%`, height: 8, borderRadius: 4, backgroundColor: first ? c.hue : t.colors.muted }} />
        </View>
      </View>
      <RNText style={tx('800', 15, t.colors.ink, { fontVariant: ['tabular-nums'] })}>{price}</RNText>
    </Pressable>
  );
}

/** One helper in the list: what they offer and their area, never a name (plan D13). */
export function HelperRow({ worker: w, now, on, onPress }: { worker: NearbyWorker; now: number; on: boolean; onPress: () => void }) {
  const t = useTheme();
  const c = useTone('people');
  const o = offerOf(w);
  const live = presenceOf(w.last_seen_at, now).online;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${o.what}${o.price ? `, from ${o.price}` : ''}${live ? ', active now' : ''}, ${areaName(w.loc_label)} area`}
      style={({ pressed }) => ({
        height: ROW_H,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 10,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: on ? c.hue : 'transparent',
        backgroundColor: on ? c.soft : pressed ? t.colors.surface2 : 'transparent',
      })}
    >
      <IconTile name={o.icon} tone="people" />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <RNText style={tx('700', 13.5, t.colors.ink)} numberOfLines={1}>
          {o.what}
          {o.more > 0 ? <RNText style={tx('600', 11.5, t.colors.muted)}>{`  +${o.more} more`}</RNText> : null}
        </RNText>
        <RNText style={tx('600', 11.5, t.colors.muted)} numberOfLines={1}>
          {areaName(w.loc_label)} · {farText(w.km)}
        </RNText>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <RNText style={tx('800', 14, o.price ? t.colors.ink : t.colors.muted, { fontVariant: ['tabular-nums'] })}>{o.price ? `from ${o.price}` : 'Skill only'}</RNText>
        {live ? <RNText style={tx('800', 10, t.colors.online)}>● Active</RNText> : null}
      </View>
    </Pressable>
  );
}

/**
 * One of "My people" in the list (plan D20): "Asha", then "2 jobs together · Active now · 1.2 km".
 * First name only, and the distance is to a rounded spot, never a place.
 */
export function PersonRow({ person: p, now, on, onPress }: { person: MapPerson; now: number; on: boolean; onPress: () => void }) {
  const t = useTheme();
  const c = useTone('people');
  const presence = presenceOf(p.last_seen_at, now);
  const name = firstName(p.display_name);
  const meta = [togetherText(p.jobs), presence.label, farText(p.km)].join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${name}, ${meta}`}
      style={({ pressed }) => ({
        height: ROW_H,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 10,
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: on ? c.hue : 'transparent',
        backgroundColor: on ? c.soft : pressed ? t.colors.surface2 : 'transparent',
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={tx('800', 13, c.ink)}>{initialsOf(p.display_name)}</RNText>
        {presence.online ? (
          <View style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: t.colors.online, borderWidth: 2, borderColor: t.colors.surface }} />
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <RNText style={tx('700', 13.5, t.colors.ink)} numberOfLines={1}>
          {name}
        </RNText>
        <RNText style={tx('600', 11.5, t.colors.muted)} numberOfLines={1}>
          {meta}
        </RNText>
      </View>
      <Icon name="chevronRight" size={14} color={t.colors.muted} />
    </Pressable>
  );
}

/**
 * A picked job: who posted it, what it is, the offer and Open task. On the
 * desktop map it sits above the pin; on a phone it replaces the sheet and
 * steps to the next job in the same area.
 */
export function JobCard({
  job: j,
  now,
  onOpen,
  onClose,
  step,
}: {
  job: MapJob;
  now: number;
  onOpen: () => void;
  onClose: () => void;
  step?: { index: number; count: number; label: string; prev: () => void; next: () => void };
}) {
  const t = useTheme();
  const c = useTone('jobs');
  const p = j.poster;
  const name = p ? firstName(p.display_name || p.username) : 'Someone';
  const presence = p ? presenceOf(p.last_seen_at, now).label : null;
  const rating = p && p.poster_rating_count > 0 ? `${Number(p.poster_rating_avg).toFixed(1)} ★` : null;
  const big = step !== undefined;
  const price = rupees(j.benchmark_minor / 100);
  const arrow = (label: string, onPress: () => void, flip: boolean) => (
    <Pressy
      onPress={onPress}
      label={label}
      style={{ width: 48, height: 48, borderRadius: 16, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
        <Icon name="chevronRight" size={18} color={t.colors.ink} />
      </View>
    </Pressy>
  );
  return (
    <View
      style={{
        borderRadius: big ? 26 : 20,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        padding: 16,
        gap: big ? 14 : 12,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 10 },
        elevation: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: big ? 36 : 32, height: big ? 36 : 32, borderRadius: 999, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('800', 12, c.ink)}>{initialsOf(p?.display_name || p?.username)}</RNText>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <RNText style={tx('700', 13.5, t.colors.ink)} numberOfLines={1}>
            {name}
          </RNText>
          {presence || rating ? (
            <RNText style={tx('600', 11.5, t.colors.muted)} numberOfLines={1}>
              {[presence, rating].filter(Boolean).join(' · ')}
            </RNText>
          ) : null}
        </View>
        <Pressy onPress={onClose} label="Close" style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={14} color={t.colors.text} />
        </Pressy>
      </View>
      <View style={{ gap: 4 }}>
        <RNText style={tx('800', big ? 17 : 15, t.colors.ink, { lineHeight: big ? 22 : 20 })} numberOfLines={2}>
          {j.title}
        </RNText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="pin" size={12} color={t.colors.muted} />
          <RNText style={tx('600', 12, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
            {areaName(j.loc_label)} area · {farText(j.km)}
          </RNText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <RNText style={tx('800', big ? 26 : 24, t.colors.ink, { fontVariant: ['tabular-nums'], letterSpacing: -0.5 })}>{price}</RNText>
        <TopUpBadge pct={j.topup_pct} compact />
        {j.fresh ? <JustPosted tone="jobs" /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {step && step.count > 1 ? arrow('Previous job', step.prev, true) : null}
        <Pressy
          onPress={onOpen}
          label={`Open task: ${j.title}`}
          style={{ flex: 1, height: big ? 48 : 44, borderRadius: big ? 16 : 14, backgroundColor: t.colors.btn, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <RNText style={tx('800', big ? 15 : 14, t.colors.onBtn)}>Open task</RNText>
          <Icon name="chevronRight" size={16} color={t.colors.onBtn} />
        </Pressy>
        {step && step.count > 1 ? arrow('Next job', step.next, false) : null}
      </View>
      {step && step.count > 1 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          {step.count <= 8
            ? Array.from({ length: step.count }, (_, i) => (
                <View key={i} style={{ width: i === step.index ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === step.index ? c.hue : t.colors.line }} />
              ))
            : null}
          <RNText style={tx('600', 11, t.colors.muted, { marginLeft: 6 })}>
            {step.index + 1} of {step.count} {step.label}
          </RNText>
        </View>
      ) : null}
    </View>
  );
}

/** "2.2 km" / "under 1 km": a distance as a value (no tilde), for the hero and tiles. */
export function kmValue(km: number): string {
  return km < 1 ? 'under 1 km' : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export type HeroTile = { label: string; value: string; sub?: string; onPress?: () => void };

/**
 * The big card at the top of the panel and the low phone sheet (plan D21): the best offer near you, large, with
 * an Open button, and three small tiles under it. In the Helpers and My people layers it holds the nearest person.
 */
export function HeroCard({
  tone,
  label,
  value,
  title,
  meta,
  onFocus,
  onOpen,
  openLabel = 'Open',
  tiles,
  compact = false,
}: {
  tone: MapTone;
  label: string;
  value: string;
  title: string;
  meta?: string;
  /** Tapping the text flies the map to it. */
  onFocus?: () => void;
  onOpen: () => void;
  openLabel?: string;
  tiles: HeroTile[];
  /** Phone: a smaller amount and tighter spacing. */
  compact?: boolean;
}) {
  const t = useTheme();
  const c = useTone(tone);
  return (
    <View style={{ borderRadius: compact ? 18 : 20, padding: compact ? 14 : 16, gap: compact ? 10 : 12, backgroundColor: c.soft, borderWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: 'row', alignItems: compact ? 'center' : 'flex-start', gap: compact ? 10 : 12 }}>
        <Pressy onPress={onFocus} label={`${label}: ${value}, ${title}${meta ? `, ${meta}` : ''}`} scaleTo={0.98} style={{ flex: 1, minWidth: 0, gap: compact ? 0 : 4 }}>
          <RNText style={tx('800', compact ? 10.5 : 11.5, c.ink, { letterSpacing: 0.6 })} numberOfLines={1}>
            {label}
          </RNText>
          <RNText style={tx('800', compact ? 28 : 34, t.colors.ink, { letterSpacing: compact ? -0.8 : -1, lineHeight: compact ? 34 : 40, fontVariant: ['tabular-nums'] })} numberOfLines={1}>
            {value}
          </RNText>
          <RNText style={tx('700', compact ? 12.5 : 13.5, t.colors.ink)} numberOfLines={1}>
            {title}
          </RNText>
          {meta && !compact ? (
            <RNText style={tx('600', 12, t.colors.muted)} numberOfLines={1}>
              {meta}
            </RNText>
          ) : null}
        </Pressy>
        <Pressy
          onPress={onOpen}
          label={`${openLabel}: ${title}`}
          style={{ height: 40, paddingHorizontal: compact ? 16 : 14, borderRadius: 14, backgroundColor: t.colors.btn, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <RNText style={tx('800', 13, t.colors.onBtn)}>{openLabel}</RNText>
          {compact ? null : <Icon name="chevronRight" size={14} color={t.colors.onBtn} />}
        </Pressy>
      </View>
      <View style={{ flexDirection: 'row', gap: compact ? 6 : 8 }}>
        {tiles.map((s) => (
          <Pressy
            key={s.label}
            onPress={s.onPress}
            disabled={!s.onPress}
            label={`${s.label}: ${s.value}${s.sub ? `, ${s.sub}` : ''}`}
            scaleTo={0.97}
            style={{ flex: 1, minWidth: 0, paddingHorizontal: compact ? 8 : 10, paddingVertical: compact ? 7 : 9, borderRadius: compact ? 10 : 12, gap: 1, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: c.border }}
          >
            <RNText style={tx('700', compact ? 10 : 10.5, t.colors.muted)} numberOfLines={1}>
              {s.label}
            </RNText>
            <RNText style={tx('800', compact ? 13 : 15, t.colors.ink, { fontVariant: ['tabular-nums'] })} numberOfLines={1}>
              {s.value}
            </RNText>
            {s.sub && !compact ? (
              <RNText style={tx('600', 10.5, t.colors.text)} numberOfLines={1}>
                {s.sub}
              </RNText>
            ) : null}
          </Pressy>
        ))}
      </View>
    </View>
  );
}

/** How far: 5 / 10 / 25 (and the saved custom one), the one in use showing "km", then "Custom". */
export function ReachControl({
  choices,
  onPick,
  onCustom,
  customOn,
}: {
  choices: { km: number; on: boolean }[];
  onPick: (km: number) => void;
  onCustom: () => void;
  /** The editor is open. */
  customOn: boolean;
}) {
  const t = useTheme();
  const cell = (on: boolean) => ({ height: 30, paddingHorizontal: 10, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: on ? t.colors.line : 'transparent' });
  return (
    <View accessibilityLabel="How far" style={{ flexDirection: 'row', padding: 3, borderRadius: 14, backgroundColor: t.colors.surface2 }}>
      {choices.map((o) => (
        <Pressable key={o.km} onPress={() => onPick(o.km)} accessibilityRole="button" accessibilityLabel={`${o.km} km`} accessibilityState={{ selected: o.on }} style={cell(o.on)}>
          <RNText style={tx(o.on ? '800' : '700', 12, o.on ? t.colors.ink : t.colors.muted)} numberOfLines={1}>
            {o.on ? `${o.km} km` : String(o.km)}
          </RNText>
        </Pressable>
      ))}
      <Pressable onPress={onCustom} accessibilityRole="button" accessibilityLabel="Custom distance" accessibilityState={{ selected: customOn }} style={cell(customOn)}>
        <RNText style={tx(customOn ? '800' : '700', 12, customOn ? t.colors.ink : t.colors.muted)} numberOfLines={1}>
          Custom
        </RNText>
      </Pressable>
    </View>
  );
}

/** "Set your distance": a whole number of km. Opens under the reach control (desktop) or under the top bar (phone). */
export function ReachEditor({
  initial,
  onSet,
  onCancel,
  minKm,
  maxKm,
  parse,
  plain = false,
}: {
  initial: number | null;
  onSet: (km: number) => void;
  onCancel: () => void;
  minKm: number;
  maxKm: number;
  parse: (s: string) => number | null;
  /** Inside a sheet that already has a title and a card: no box and no heading of its own. */
  plain?: boolean;
}) {
  const t = useTheme();
  // Starts on the last custom distance, else 45 (the example), already selected: type to replace it. An empty box looked
  // like it held a number (a faint "45") and Set then refused it.
  const [text, setText] = useState(String(initial ?? 45));
  const [bad, setBad] = useState(false);
  const submit = () => {
    const km = parse(text);
    if (km === null) return setBad(true);
    onSet(km);
  };
  return (
    <View
      style={
        plain
          ? { gap: 10 }
          : { gap: 10, padding: 14, borderRadius: 16, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 }
      }
    >
      {plain ? null : (
        <RNText accessibilityRole="header" style={tx('800', 14, t.colors.ink)}>
          Set your distance
        </RNText>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            setText(v.replace(/[^0-9]/g, '').slice(0, 3));
            setBad(false);
          }}
          onSubmitEditing={submit}
          autoFocus
          selectTextOnFocus
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={3}
          returnKeyType="done"
          placeholder="km"
          placeholderTextColor={t.colors.muted}
          accessibilityLabel="Distance in kilometres"
          style={{ width: 84, height: 42, borderRadius: 12, borderWidth: 1, borderColor: bad ? t.colors.signalDeep : t.colors.line, backgroundColor: t.colors.surface2, paddingHorizontal: 12, textAlign: 'center', ...tx('800', 16, t.colors.ink, { fontVariant: ['tabular-nums'] }) }}
        />
        <RNText style={tx('700', 13, t.colors.muted)}>km</RNText>
        <View style={{ flex: 1 }} />
        <Pressy onPress={onCancel} label="Cancel" style={{ height: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('700', 13, t.colors.text)}>Cancel</RNText>
        </Pressy>
        <Pressy onPress={submit} label="Set distance" style={{ height: 40, paddingHorizontal: 18, borderRadius: 12, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('800', 13, t.colors.onBtn)}>Set</RNText>
        </Pressy>
      </View>
      <RNText style={tx('600', 11.5, bad ? t.colors.signalDeep : t.colors.muted)}>
        {bad ? `Enter a whole number from ${minKm} to ${maxKm}.` : `e.g. 45 or 50. A whole number from ${minKm} to ${maxKm} km.`}
      </RNText>
    </View>
  );
}

/** The quiet pill at the top of the map: how many are in this part of the map, or that it is looking. */
export function StatusPill({ text, busy }: { text: string; busy: boolean }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: busy ? t.colors.muted : t.colors.online }} />
      <RNText style={tx('700', 12.5, t.colors.text)} numberOfLines={1}>
        {text}
      </RNText>
    </View>
  );
}

/** The one-line note at the foot of the panel. */
export function PrivacyLine({ text, tone }: { text: string; tone: MapTone }) {
  const t = useTheme();
  const c = useTone(tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="lock" size={12} color={c.ink} />
      <RNText style={tx('600', 11.5, t.colors.muted, { flexShrink: 1 })} numberOfLines={2}>
        {text}
      </RNText>
    </View>
  );
}

const FADE_STEPS = 8;

/**
 * The list that fills the rest of the panel. No scroll bar: when more is hidden below, the bottom fades out and
 * says "N more below" (plan D21).
 */
export function FadeList({
  listRef,
  children,
  contentStyle,
  rowHeight = ROW_H + ROW_GAP,
}: {
  listRef?: React.Ref<ScrollViewInstance>;
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  rowHeight?: number;
}) {
  const t = useTheme();
  const [view, setView] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const hidden = Math.max(0, content - view - offset);
  const more = hidden > 8 ? Math.max(1, Math.round(hidden / rowHeight)) : 0;
  return (
    <View style={{ flex: 1, minHeight: 0 }} onLayout={(e) => setView(e.nativeEvent.layout.height)}>
      <ScrollView
        ref={listRef}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={(_w, h) => setContent(h)}
        onScroll={(e) => setOffset(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
        contentContainerStyle={contentStyle}
      >
        {children}
      </ScrollView>
      {more > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          {Array.from({ length: FADE_STEPS }, (_, i) => (
            <View key={i} style={{ height: 7, backgroundColor: t.colors.surface, opacity: (i + 1) / FADE_STEPS }} />
          ))}
          <View style={{ height: 22, backgroundColor: t.colors.surface, alignItems: 'center' }}>
            <RNText style={tx('700', 11.5, t.colors.muted)}>{more} more below</RNText>
          </View>
        </View>
      ) : null}
    </View>
  );
}
