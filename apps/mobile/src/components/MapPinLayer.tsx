import { useMemo } from 'react';
import { View, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { groupPins } from '../lib/mapCluster';
import { layoutPins, topAmount, type MapItem } from '../lib/mapLayout';
import { MAX_FRESH, areaAt, easeOut, introDelays, introEnd, rippleAt, tagAt } from '../lib/mapMotion';
import { useMapClock } from './useMapClock';
import { FACE_PIN, FACE_STACK, FacePin, FaceStack, PRICE_PIN, PricePin, TASK_PIN, TaskPin, type Face } from './MapMarkers';

/**
 * One thing on the map. Jobs carry their price as `label` and in rupees as
 * `amount` (an area shows its biggest offer), plus, once known, who posted it
 * and what it is. People (a poster's map of helpers) carry `face` (a service
 * icon), what they offer as `label`, its starting `price` (none when they only
 * list skills) and `more`, their other services; never a name (plan D13).
 * `area` is the place's name ("Madhapur"). `fresh` marks a task posted in the
 * last few minutes, which ripples.
 */
export type JobPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  fresh?: boolean;
  face?: Face;
  name?: string;
  price?: string | null;
  more?: number;
  amount?: number;
  who?: string;
  title?: string;
  area?: string;
};

/** Jobs are money (the mode's colour); helpers are faces on blue. */
export type MapTone = 'jobs' | 'people';

/** Pins closer than this many pixels join into one group. */
export const CLUSTER_PX = 80;
/** Face stacks are wider, so they join sooner. */
export const CLUSTER_PX_PEOPLE = 96;
/** How far apart pins sit once a group spreads out: across, and up and down. */
export const SPREAD_GAP = { x: 150, y: 104 };
/** Helpers' tags carry a service and price, so they need nearly a job pin's width. */
export const SPREAD_GAP_PEOPLE = { x: 140, y: 98 };
/** Spreading pins fly out from the group's centre for this long. */
export const SPREAD_MS = 450;
/** How far a callout lifts its pin below the middle, so the card above it stays on screen. */
export const CALLOUT_LIFT = 110;
export const CALLOUT_W = 300;

/** Short text for the legend and screen readers, by tone. */
export function mapWords(tone: MapTone) {
  return tone === 'people'
    ? { area: 'Helper area', privacy: 'Pins sit in their area, never at a home. Tap to see who', one: 'helper', many: 'helpers', legend: 'Tap a group to see everyone' }
    : { area: 'Job area', privacy: 'Pins show the area, never the exact spot', one: 'job', many: 'jobs', legend: 'Each pin is the biggest offer in that area' };
}

/** What a screen reader says for a helper's pin: the service, never the name. */
export function helperSays(pin: JobPin): string {
  const what = pin.price ? `${pin.label}, from ${pin.price}` : pin.label;
  const more = pin.more ? `, ${pin.more} more ${pin.more === 1 ? 'service' : 'services'}` : '';
  return `${what}${more}${pin.face?.live ? ', active now' : ''}, ${pin.area ?? 'nearby'} area. Tap to see who`;
}

/**
 * The group's or pin's place name, for the label under it. A group that joins
 * several areas says so ("Financial District +3"), so its count never reads as
 * the count of that one area (the Best-paying areas list counts one area each).
 */
export function placeOf(ids: string[], byId: Map<string, JobPin>): string {
  const first = byId.get(ids[0]!)?.area ?? 'Nearby';
  const others = new Set<string>();
  for (const id of ids) {
    const a = byId.get(id)?.area;
    if (a && a !== first) others.add(a);
  }
  return others.size === 0 ? first : `${first} +${others.size}`;
}

/** For jobs: each item's biggest offer and the best one on screen, which is drawn in the mode's colour. */
export function offersOf(items: MapItem[], byId: Map<string, JobPin>) {
  const amountOf = (id: string) => byId.get(id)?.amount;
  const top = items.map((it) => (it.kind === 'group' ? topAmount(it.ids, amountOf) : (amountOf(it.id) ?? null)));
  const best = top.reduce<number | null>((m, a) => (a !== null && (m === null || a > m) ? a : m), null);
  return { top, best };
}

/** Jobs with the biggest offer first; people keep the caller's order. */
export function byOffer(pins: JobPin[], people: boolean): JobPin[] {
  return people ? pins : [...pins].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
}

/** The pin with the biggest offer in a group: its price is the one shown. */
export function topPinOf(ids: string[], byId: Map<string, JobPin>): JobPin {
  let pick = byId.get(ids[0]!)!;
  for (const id of ids) {
    const p = byId.get(id)!;
    if ((p.amount ?? 0) > (pick.amount ?? 0)) pick = p;
  }
  return pick;
}

type Props = {
  pins: JobPin[];
  tone: MapTone;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  dim: boolean;
  callout?: React.ReactNode;
  /** The part of the map covered by a side panel on the left, so a callout never hides under it. */
  leftInset: number;
  size: { w: number; h: number };
  /** Zoom in 256-px tile levels (the tile map's own; the GL map passes its zoom + 1). Fractional is fine. */
  zoom: number;
  toScreen: (lat: number, lng: number) => { x: number; y: number };
  /** You, on screen, so the intro pops nearest first. */
  you: { x: number; y: number } | null;
  /** A group was tapped at this point on screen: the map zooms into it. */
  onGroup: (x: number, y: number) => void;
};

/**
 * Everything the job and helper maps draw over the map itself (plan D12 to D14,
 * D21): soft areas behind spread groups, the heat glow, price pins, face pins,
 * groups that zoom in when tapped, and the picked job's card. The tile map and
 * the GL map (web) both use it, so the pins look and move the same on both.
 */
export function MapPinLayer({ pins, tone, selectedId, onSelect, dim, callout, leftInset, size, zoom, toScreen, you, onGroup }: Props) {
  const t = useTheme();
  const people = tone === 'people';
  const hue = people ? t.colors.purple : t.colors.btn;
  const words = mapWords(tone);
  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  // A spread area puts its first pin at the top: the biggest offer, or (as the caller orders them) someone active now.
  const placed = byOffer(pins, people).map((p) => ({ id: p.id, ...toScreen(p.lat, p.lng) }));
  const inView = placed.filter((p) => p.x > -120 && p.x < size.w + 120 && p.y > -120 && p.y < size.h + 120);
  const items = layoutPins(groupPins(inView, people ? CLUSTER_PX_PEOPLE : CLUSTER_PX), { zoom, gap: people ? SPREAD_GAP_PEOPLE : SPREAD_GAP });
  const offers = people ? null : offersOf(items, byId);

  // The intro replays for a new set of things, not when the map is moved.
  const introKey = useMemo(() => pins.map((p) => p.id).sort().join('|'), [pins]);
  const freshIds = useMemo(() => new Set(pins.filter((p) => p.fresh).slice(0, MAX_FRESH).map((p) => p.id)), [pins]);
  const clock = useMapClock(introKey, introEnd(pins.length), freshIds.size > 0);
  const delays = introDelays(items, you);
  // Groups that have just spread fly out from their centre.
  const spreadKey = items.map((it) => (it.kind === 'one' && it.area ? it.id : '')).join('');
  const spreadClock = useMapClock(spreadKey, SPREAD_MS, false);
  const fan = easeOut(spreadClock.elapsed / SPREAD_MS);
  const at = (it: MapItem) =>
    it.kind === 'one' && it.area ? { x: it.area.x + (it.x - it.area.x) * fan, y: it.area.y + (it.y - it.area.y) * fan } : { x: it.x, y: it.y };

  // Where the picked pin is drawn, when it stands alone (a group zooms in first), and how tall it is.
  const pickedItem = callout && selectedId ? items.find((it) => it.kind === 'one' && it.id === selectedId) : undefined;
  const pickedAt = pickedItem
    ? { ...at(pickedItem), lift: (pickedItem.kind === 'one' && pickedItem.area ? TASK_PIN.anchor : PRICE_PIN.anchor) + 10 }
    : null;

  const areas = new Map<string, { x: number; y: number; r: number }>();
  for (const it of items) if (it.kind === 'one' && it.area) areas.set(`${it.area.x},${it.area.y}`, { x: it.area.x, y: it.area.y, r: Math.max(it.area.rx, it.area.ry) });

  return (
    <>
      {/* Spread areas: one soft circle behind everyone in it, never a spot. */}
      {[...areas.entries()].map(([key, a]) => (
        <View
          key={'area-' + key}
          pointerEvents="none"
          style={{ position: 'absolute', left: a.x - a.r, top: a.y - a.r, width: a.r * 2, height: a.r * 2, borderRadius: 999, backgroundColor: hue + '1A', borderWidth: 1, borderColor: hue + '80', borderStyle: 'dashed' }}
        />
      ))}

      {/* Jobs: a soft heat glow under each area, stronger where the biggest offer is higher. */}
      {offers && offers.best
        ? items.map((it, i) => {
            if (it.kind === 'one' && it.area) return null;
            const k = (offers.top[i] ?? 0) / offers.best!;
            const a = areaAt(clock.elapsed, delays[i]!);
            if (!a.shown) return null;
            const r = (36 + 46 * k) * a.scale;
            return (
              <View key={'heat-' + i} pointerEvents="none" style={{ position: 'absolute', left: it.x - r, top: it.y - r, width: r * 2, height: r * 2, alignItems: 'center', justifyContent: 'center' }}>
                {[1, 0.66, 0.36].map((s) => (
                  <View key={s} style={{ position: 'absolute', width: r * 2 * s, height: r * 2 * s, borderRadius: 999, backgroundColor: hue, opacity: 0.05 + 0.1 * k }} />
                ))}
              </View>
            );
          })
        : null}

      {items.map((it, i) => {
        const pop = tagAt(clock.elapsed, delays[i]!);
        if (pop === 0) return null;
        const p = at(it);
        const back = dim && selectedId !== null && !(it.kind === 'one' && it.id === selectedId);
        const drop = { opacity: pop * (back ? 0.45 : 1), transform: [{ translateY: -10 * (1 - pop) }] };
        if (it.kind === 'group') {
          const key = 'g-' + it.ids.join('|');
          const into = () => onGroup(it.x, it.y);
          if (people) {
            const shown = it.ids.slice(0, 3).map((id) => ({ seed: id, face: byId.get(id)!.face ?? { initials: '?', live: false } }));
            return (
              <Pressable
                key={key}
                onPress={into}
                accessibilityRole="button"
                accessibilityLabel={`${it.ids.length} ${words.many} in ${placeOf(it.ids, byId)} area. Spread them out`}
                style={[{ position: 'absolute', left: p.x - FACE_STACK.w / 2, top: p.y - FACE_STACK.anchor, zIndex: 1 }, drop]}
              >
                <FaceStack faces={shown} extra={it.ids.length - shown.length} label={`${placeOf(it.ids, byId)} · ${it.ids.length}`} />
              </Pressable>
            );
          }
          const topPin = topPinOf(it.ids, byId);
          const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
          return (
            <Pressable
              key={key}
              onPress={into}
              accessibilityRole="button"
              accessibilityLabel={`${it.ids.length} ${words.many} in ${placeOf(it.ids, byId)} area, biggest offer ${topPin.label}. Zoom in`}
              style={[{ position: 'absolute', left: p.x - PRICE_PIN.w / 2, top: p.y - PRICE_PIN.anchor, zIndex: best ? 2 : 1 }, drop]}
            >
              <PricePin price={topPin.label} best={best} on={false} place={placeOf(it.ids, byId)} count={`${it.ids.length} ${words.many}`} />
            </Pressable>
          );
        }

        const pin = byId.get(it.id)!;
        const on = selectedId === it.id;
        const pick = () => onSelect(on ? null : it.id);
        const spread = it.area !== null;
        if (people) {
          return (
            <Pressable
              key={'p-' + it.id}
              onPress={pick}
              accessibilityRole="button"
              accessibilityLabel={helperSays(pin)}
              accessibilityState={{ selected: on }}
              style={[{ position: 'absolute', left: p.x - FACE_PIN.w / 2, top: p.y - FACE_PIN.anchor, zIndex: on ? 3 : 1 }, drop]}
            >
              <FacePin face={pin.face ?? { initials: '?', live: false }} seed={pin.id} what={pin.label} price={pin.price} more={pin.more} on={on} glow />
            </Pressable>
          );
        }
        const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
        const ripple = freshIds.has(it.id) && !clock.still ? rippleAt(clock.now, i * 1200) : null;
        return (
          <View key={'j-' + it.id} pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, zIndex: on ? 3 : best ? 2 : 1 }}>
            {ripple !== null ? (
              <View
                pointerEvents="none"
                style={{ position: 'absolute', left: p.x - 20 - 30 * ripple, top: p.y - 20 - 30 * ripple, width: 40 + 60 * ripple, height: 40 + 60 * ripple, borderRadius: 999, borderWidth: 2, borderColor: hue, opacity: 0.8 * (1 - ripple) }}
              />
            ) : null}
            <Pressable
              onPress={pick}
              accessibilityRole="button"
              accessibilityLabel={`${pin.label}${pin.title ? ', ' + pin.title : ''}${pin.who ? ', posted by ' + pin.who : ''}, ${pin.area ?? 'nearby'} area`}
              accessibilityState={{ selected: on }}
              style={[{ position: 'absolute', left: p.x - (spread ? TASK_PIN.w : PRICE_PIN.w) / 2, top: p.y - (spread ? TASK_PIN.anchor : PRICE_PIN.anchor) }, drop]}
            >
              {spread ? (
                <TaskPin price={pin.label} face={pin.face} seed={pin.id} who={pin.who} title={pin.title} best={best} on={on} />
              ) : (
                <PricePin price={pin.label} best={best} on={on} place={pin.area ?? 'Nearby'} />
              )}
            </Pressable>
          </View>
        );
      })}

      {/* The picked pin's card sits right above it (desktop, plan D14). */}
      {callout && pickedAt ? (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: Math.max(leftInset + 8, Math.min(pickedAt.x - CALLOUT_W / 2, size.w - CALLOUT_W - 8)), bottom: size.h - pickedAt.y + pickedAt.lift, width: CALLOUT_W, zIndex: 5 }}
        >
          {callout}
        </View>
      ) : null}
    </>
  );
}
