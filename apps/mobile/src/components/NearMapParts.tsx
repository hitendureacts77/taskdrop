import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import type { TaskWithPoster } from '../data/api';
import type { NearbyWorker } from '../data/extras';
import { presenceOf } from '../lib/presence';
import { areaName, farText, firstName, initialsOf, offerOf } from './mapPins';
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
export function StatTiles({ tiles, tone }: { tiles: { label: string; value: string; sub: string; strong?: boolean; onPress?: () => void }[]; tone: MapTone }) {
  const t = useTheme();
  const c = useTone(tone);
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {tiles.map((s) => (
        <Pressy
          key={s.label}
          onPress={s.onPress}
          label={`${s.label}: ${s.value}, ${s.sub}`}
          scaleTo={0.97}
          style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, gap: 2, backgroundColor: s.strong ? c.soft : t.colors.surface2, borderWidth: 1, borderColor: s.strong ? c.border : t.colors.line }}
        >
          <RNText style={tx('700', 11, s.strong ? c.ink : t.colors.muted)}>{s.label}</RNText>
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

/** The two notes that used to sit over the map: privacy, and what a pin means. */
export function MapNotes({ tone, legend = true }: { tone: MapTone; legend?: boolean }) {
  const t = useTheme();
  const c = useTone(tone);
  const words = mapWords(tone);
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
  const tasks = `${a.count} ${a.count === 1 ? 'task' : 'tasks'}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a.name}, biggest offer ${price}, ${tasks}, ${farText(a.km)}`}
      style={({ pressed }) => ({ height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: 16, backgroundColor: pressed ? t.colors.surface2 : 'transparent' })}
    >
      <IconTile name="pin" tone="jobs" />
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <RNText style={tx('700', 13.5, t.colors.ink, { flexShrink: 1 })} numberOfLines={1}>
            {a.name}
          </RNText>
          <RNText style={tx('600', 11.5, t.colors.muted)} numberOfLines={1}>
            {tasks} · {farText(a.km)}
          </RNText>
        </View>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.colors.line, overflow: 'hidden' }}>
          <View style={{ width: `${Math.round((100 * a.top.benchmark_minor) / (best || 1))}%`, height: 4, borderRadius: 2, backgroundColor: first ? c.hue : t.colors.muted }} />
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
