import { useEffect, useMemo } from 'react';
import { View, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { groupPins } from '../lib/mapCluster';
import { SPREAD_ZOOM, layoutPins, topAmount, type MapItem, type PinBox } from '../lib/mapLayout';
import { MAX_FRESH, TAG_MS, areaAt, easeOut, introDelays, introEnd } from '../lib/mapMotion';
import type { PinEnter } from './MapMarkers';
import { bubbleRect, helperPinRects, planLabels, planSpread, stackRects, taskPinRects, youRect, type LabelItem, type LabelPlan, type Rect, type SpreadItem } from '../lib/mapLabels';
import { useMapClock } from './useMapClock';
import { usePinEpoch } from './usePinEpoch';
import { FACE_PIN, FACE_STACK, FacePin, FaceStack, PRICE_PIN, PROMO_PIN, PinMotion, PricePin, PromotedPin, TASK_PIN, TaskPin, sideHue, type Face } from './MapMarkers';

/**
 * One thing on the map. Jobs carry their price as `label` and in rupees as
 * `amount` (an area shows its biggest offer), their service icon as `face.icon`
 * and the service's name as `what`; never the poster (task 1.21 row A: who
 * posted it shows only after a tap). People (a poster's map of helpers) carry `face` (a service
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
  /** A job's service, for screen readers ("Repairs & Maintenance"). */
  what?: string;
  who?: string;
  title?: string;
  area?: string;
  /** A live promotion (task 1.19 row C): a bigger, side-coloured pin drawn above the others. */
  promoted?: boolean;
};

/** Jobs are money (royal blue, Earn); helpers are service icons on jade (Hire). */
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

/** What a screen reader says for a task's pin: the service and price, never the poster (task 1.21 row A). */
export function jobSays(pin: JobPin): string {
  return `${pin.what ? pin.what + ', ' : ''}${pin.label}, ${pin.area ?? 'nearby'} area. Tap to see the job`;
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

/** The words under a stack of helpers: the area (or areas) and how many. */
export function stackLabel(ids: string[], byId: Map<string, JobPin>): string {
  return `${placeOf(ids, byId)} · ${ids.length}`;
}

/** A promoted pin's disc at point (x, y) (PROMO_PIN: 72 px, its pointer's dot on the point). */
function promoRect(x: number, y: number): Rect {
  return { x: x - 36, y: y - PROMO_PIN.anchor, w: 72, h: 72 };
}

/** A job pin's pointer and dot under its bubble: 6 px triangle, 2 px gap, 8 px dot. */
const POINTER = 16;

/**
 * A pin's bubble round its point (lib/mapLayout.ts PinBox), what no other pin's bubble may cover: a lone job's
 * price bubble, a spread job's face and price, a helper's icon and price, a promoted disc. A job's bubble keeps
 * its pointer and dot (the 16 px under it, down to the area's point) so no other bubble hides where it points.
 * A lone job is sized as if it were the best offer (its trending icon): the best one is known only after the layout.
 */
export function pinBox(pin: JobPin | undefined, people: boolean, spread: boolean): PinBox {
  if (!pin) return { x: -50, y: -48, w: 100, h: 36 + POINTER };
  if (pin.promoted) return promoRect(0, 0);
  if (people) return helperPinRects(0, 0, pin.label, pin.price).compact;
  const b = spread ? taskPinRects(0, 0, pin.label, pin.who, pin.title, !!pin.face).compact : bubbleRect(0, 0, pin.label, true);
  return { ...b, h: b.h + POINTER };
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

/** One key per thing drawn: a group by its members, a pin by its id. */
export function itemKey(it: MapItem): string {
  return it.kind === 'group' ? 'g-' + it.ids.join('|') : it.id;
}

/**
 * Where the job price pins' words go (P1-14, lib/mapLabels.ts): which area names fit and which pins step
 * out from under the map's buttons. Spread pins (TaskPin) and helpers keep their words; only their room is taken.
 */
export function pinLabels(
  items: MapItem[],
  byId: Map<string, JobPin>,
  offers: { top: (number | null)[] } | null,
  selectedId: string | null,
  manyWord: string,
  opts: { avoid?: Rect[]; controls?: Rect | null },
  people = false,
): Map<string, LabelPlan> {
  // Price pins and group pins (names step back, P1-14). Their bubbles are fixed; spread pins plan around them.
  const list: LabelItem[] = [];
  items.forEach((it, i) => {
    if (!offers || (it.kind === 'one' && it.area)) return;
    const rank = (it.kind === 'one' && it.id === selectedId ? 1e12 : 0) + (offers.top[i] ?? 0);
    if (it.kind === 'group') {
      const top = topPinOf(it.ids, byId);
      list.push({ id: itemKey(it), x: it.x, y: it.y, price: top.label, tag: `${placeOf(it.ids, byId)} · ${it.ids.length} ${manyWord}`, rank });
    } else {
      const pin = byId.get(it.id);
      if (pin) list.push({ id: it.id, x: it.x, y: it.y, price: pin.label, tag: pin.area ?? 'Nearby', rank });
    }
  });
  // Spread pins (D33): the full tag steps back to compact where it would overlap a better pin's box (best first = list order).
  // Helpers too, alone or stacked: a stack's area name ("Hyderabad +6 · 7") steps back near the "Your area" pill.
  const spreadList: SpreadItem[] = [];
  items.forEach((it, i) => {
    if (it.kind === 'group') {
      if (!people) return;
      const shown = Math.min(3, it.ids.length);
      spreadList.push({ id: itemKey(it), ...stackRects(it.x, it.y, shown, it.ids.length - shown, stackLabel(it.ids, byId)), rank: -i });
      return;
    }
    const pin = it.area || people ? byId.get(it.id) : undefined;
    if (!pin) return;
    // A promoted pin has no words to step back: one box (the same object) for both.
    const promo = pin.promoted ? promoRect(it.x, it.y) : null;
    const r = promo ? { full: promo, compact: promo } : people ? helperPinRects(it.x, it.y, pin.label, pin.price) : taskPinRects(it.x, it.y, pin.label, pin.who, pin.title, !!pin.face);
    spreadList.push({ id: it.id, ...r, rank: -i, keep: it.id === selectedId });
  });
  const fixed = list.map((l) => bubbleRect(l.x, l.y, l.price));
  const compact = planSpread(spreadList, { avoid: [...(opts.avoid ?? []), ...(opts.controls ? [opts.controls] : []), ...fixed] });
  const out = new Map<string, LabelPlan>();
  for (const s of spreadList) out.set(s.id, { dx: 0, showTag: !compact.has(s.id) });
  // A price pin's name never covers a spread pin's words either.
  const room = spreadList.map((s) => (compact.has(s.id) ? s.compact : s.full));
  for (const [k, v] of planLabels(list, { ...opts, avoid: [...(opts.avoid ?? []), ...room] })) out.set(k, v);
  return out;
}

/** The column of map buttons at the top right, as a box on screen. */
export function controlsRect(size: { w: number }, o: { right: number; top: number; button: number; gap: number; count: number }): Rect | null {
  if (o.count <= 0) return null;
  return { x: size.w - o.right - o.button, y: o.top, w: o.button, h: o.count * o.button + (o.count - 1) * o.gap };
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
  /** The map's button column, which pins step out from under (controlsRect). */
  controls?: Rect | null;
  /** "You" is a live position: its marker carries a pill, which names must not cover. */
  youLive?: boolean;
  /**
   * The GL map's frozen layout frame (plan 1.20 step C). With it, grouping, spreading and labels run only
   * when the frame changes (the map stopped moving); while the map moves the pins just follow their places
   * through `toScreen`. Without it (tile map) the layout follows `toScreen` and `zoom` on every render.
   */
  layoutAt?: LayoutFrame;
  /**
   * The GL map draws the soft area circles and the heat glow itself (lib/mapLayers.ts), so they are not
   * drawn here; this is told the layout each time it is made, to feed those layers.
   */
  onScene?: (scene: Scene) => void;
};

/** The map as it stood when the layout was made: flat screen pixels at an app zoom, and back to places. */
export type LayoutFrame = {
  zoom: number;
  toScreen: (lat: number, lng: number) => { x: number; y: number };
  toPlace: (x: number, y: number) => { lat: number; lng: number };
  you: { x: number; y: number } | null;
  /** Metres per pixel at this zoom, for the shape layers. */
  mpp: number;
};

export type Scene = { items: MapItem[]; offers: { top: (number | null)[]; best: number | null } | null; frame: LayoutFrame };

type Geo = { p: { lat: number; lng: number }; area: { lat: number; lng: number } | null };

/**
 * Everything the job and helper maps draw over the map itself (plan D12 to D14,
 * D21): soft areas behind spread groups, the heat glow, price pins, face pins,
 * groups that zoom in when tapped, and the picked job's card. The tile map and
 * the GL map (web) both use it, so the pins look and move the same on both.
 */
export function MapPinLayer({ pins, tone, selectedId, onSelect, dim, callout, leftInset, size, zoom, toScreen, you, onGroup, controls = null, youLive = false, layoutAt, onScene }: Props) {
  const t = useTheme();
  const people = tone === 'people';
  const hue = sideHue(t, people);
  const words = mapWords(tone);
  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  const engine = onScene !== undefined;
  const controlsKey = controls ? `${controls.x},${controls.y},${controls.w},${controls.h}` : '';

  // The layout: which pins group, where spread pins sit, which names fit. With a frozen frame it is made once per
  // stop of the map, not on every frame of a move (plan 1.20 step C).
  const layout = useMemo(() => {
    const f: LayoutFrame = layoutAt ?? { zoom, toScreen, toPlace: (x, y) => ({ lat: y, lng: x }), you, mpp: 0 };
    // A spread area puts its first pin at the top: the biggest offer, or (as the caller orders them) someone active now.
    const placed = byOffer(pins, people).map((p) => ({ id: p.id, ...f.toScreen(p.lat, p.lng) }));
    // A frozen layout shows a wider margin, so pins are already there when a drag brings them in.
    const margin = layoutAt ? 240 : 120;
    const inView = placed.filter((p) => p.x > -margin && p.x < size.w + margin && p.y > -margin && p.y < size.h + margin);
    const items = layoutPins(groupPins(inView, people ? CLUSTER_PX_PEOPLE : CLUSTER_PX), {
      zoom: f.zoom,
      gap: people ? SPREAD_GAP_PEOPLE : SPREAD_GAP,
      box: (id, spread) => pinBox(byId.get(id), people, spread),
    });
    const offers = people ? null : offersOf(items, byId);
    // Names that would overlap step back, and pins under the buttons step aside (P1-14).
    const labels = pinLabels(items, byId, offers, selectedId, words.many, { avoid: f.you ? [youRect(f.you.x, f.you.y, true, !youLive)] : [], controls }, people);
    const delays = introDelays(items, f.you);
    const geo: (Geo | null)[] = items.map((it) =>
      layoutAt ? { p: layoutAt.toPlace(it.x, it.y), area: it.kind === 'one' && it.area ? layoutAt.toPlace(it.area.x, it.area.y) : null } : null,
    );
    return { items, offers, labels, delays, geo };
    // controls is keyed by its numbers; toScreen, zoom and you only matter to a layout that follows them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, people, layoutAt, layoutAt ? null : toScreen, layoutAt ? null : zoom, layoutAt ? null : you, size.w, size.h, selectedId, controlsKey, youLive]);
  const { items, offers, labels, delays, geo } = layout;
  const nudge = (it: MapItem) => labels.get(itemKey(it))?.dx ?? 0;
  const tagShown = (it: MapItem) => labels.get(itemKey(it))?.showTag ?? true;

  useEffect(() => {
    if (onScene && layoutAt) onScene({ items: layout.items, offers: layout.offers, frame: layoutAt });
    // Told once per layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // The intro replays for a new set of things, not when the map is moved.
  const introKey = useMemo(() => pins.map((p) => p.id).sort().join('|'), [pins]);
  const freshIds = useMemo(() => new Set(pins.filter((p) => p.fresh).slice(0, MAX_FRESH).map((p) => p.id)), [pins]);
  // The intro and the fold play inside each pin (PinMotion); this only says whether a pin that mounts now should.
  const introLive = usePinEpoch(introKey, introEnd(pins.length) + TAG_MS);
  // Groups that have just spread fly out from their centre.
  // The fly-out plays when the zoom crosses the spread level, not each time a pin enters or leaves the view
  // (a pan used to make every spread pin snap back and fly out again).
  const spreadKey = zoom >= SPREAD_ZOOM ? 'spread' : 'stacked';
  const spreadClock = useMapClock(spreadKey, SPREAD_MS, false);
  const foldLive = usePinEpoch(spreadKey, SPREAD_MS + 100);
  const fan = easeOut(spreadClock.elapsed / SPREAD_MS);
  // Where an item is drawn now: the layout's own pixels, or (frozen layout) its place seen through the live map.
  const at = (it: MapItem, i: number) => {
    const g = geo[i];
    const base = g ? toScreen(g.p.lat, g.p.lng) : { x: it.x, y: it.y };
    const area = g?.area ? toScreen(g.area.lat, g.area.lng) : it.kind === 'one' && it.area ? { x: it.area.x, y: it.area.y } : null;
    return it.kind === 'one' && area ? { x: area.x + (base.x - area.x) * fan, y: area.y + (base.y - area.y) * fan } : { x: base.x + nudge(it), y: base.y };
  };

  // Where the picked pin is drawn, when it stands alone (a group zooms in first), and how tall it is.
  const pickedIdx = callout && selectedId ? items.findIndex((it) => it.kind === 'one' && it.id === selectedId) : -1;
  const pickedItem = pickedIdx >= 0 ? (items[pickedIdx] as Extract<MapItem, { kind: 'one' }>) : undefined;
  const pickedAt = pickedItem
    ? { ...at(pickedItem, pickedIdx), lift: (byId.get(pickedItem.id)?.promoted ? PROMO_PIN.anchor : pickedItem.kind === 'one' && pickedItem.area ? TASK_PIN.anchor : PRICE_PIN.anchor) + 10 }
    : null;

  return (
    <>
      {engine ? null : <AreaShapes items={items} offers={offers} hue={hue} delays={delays} introKey={introKey} count={pins.length} />}

      {items.map((it, i) => {
        // Intro for a new set of things; a group that appears after a fold scales in too.
        const enter: PinEnter | null = introLive ? { delay: delays[i]!, ms: TAG_MS, from: 0.8 } : foldLive && it.kind === 'group' ? { delay: 0, ms: TAG_MS, from: 0.6 } : null;
        const p = at(it, i);
        const back = dim && selectedId !== null && !(it.kind === 'one' && it.id === selectedId);
        const drop = { opacity: back ? 0.45 : 1 };
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
                <PinMotion box={FACE_STACK} enter={enter}>
                  <FaceStack faces={shown} extra={it.ids.length - shown.length} label={stackLabel(it.ids, byId)} compact={!tagShown(it)} />
                </PinMotion>
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
              <PinMotion box={PRICE_PIN} enter={enter}>
                <PricePin price={topPin.label} icon={topPin.face?.icon} best={best} on={false} place={placeOf(it.ids, byId)} count={`${it.ids.length} ${words.many}`} hidePlace={!tagShown(it)} />
              </PinMotion>
            </Pressable>
          );
        }

        const pin = byId.get(it.id)!;
        const on = selectedId === it.id;
        const pick = () => onSelect(on ? null : it.id);
        const spread = it.area !== null;
        if (people && pin.promoted) {
          return (
            <Pressable
              key={'p-' + it.id}
              onPress={pick}
              accessibilityRole="button"
              accessibilityLabel={'Promoted. ' + helperSays(pin)}
              accessibilityState={{ selected: on }}
              style={[{ position: 'absolute', left: p.x - PROMO_PIN.w / 2, top: p.y - PROMO_PIN.anchor, zIndex: on ? 5 : 4 }, drop]}
            >
              <PinMotion box={PROMO_PIN} enter={enter}>
                <PromotedPin side="hire" price={pin.price ?? null} on={on} />
              </PinMotion>
            </Pressable>
          );
        }
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
              <PinMotion box={FACE_PIN} enter={enter}>
                <FacePin face={pin.face ?? { initials: '?', live: false }} seed={pin.id} what={pin.label} price={pin.price} more={pin.more} on={on} glow compact={!tagShown(it)} />
              </PinMotion>
            </Pressable>
          );
        }
        if (pin.promoted) {
          return (
            <View key={'j-' + it.id} pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, zIndex: on ? 5 : 4 }}>
              <Pressable
                onPress={pick}
                accessibilityRole="button"
                accessibilityLabel={`Promoted. ${jobSays(pin)}`}
                accessibilityState={{ selected: on }}
                style={[{ position: 'absolute', left: p.x - PROMO_PIN.w / 2, top: p.y - PROMO_PIN.anchor }, drop]}
              >
                <PinMotion box={PROMO_PIN} enter={enter}>
                  <PromotedPin side="earn" price={pin.label} on={on} icon={pin.face?.icon} />
                </PinMotion>
              </Pressable>
            </View>
          );
        }
        const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
        const turn = [...freshIds].indexOf(it.id);
        return (
          <View key={'j-' + it.id} pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, zIndex: on ? 3 : best ? 2 : 1 }}>
            <Pressable
              onPress={pick}
              accessibilityRole="button"
              accessibilityLabel={jobSays(pin)}
              accessibilityState={{ selected: on }}
              style={[{ position: 'absolute', left: p.x - (spread ? TASK_PIN.w : PRICE_PIN.w) / 2, top: p.y - (spread ? TASK_PIN.anchor : PRICE_PIN.anchor) }, drop]}
            >
              <PinMotion box={spread ? TASK_PIN : PRICE_PIN} enter={enter} ripple={turn >= 0 ? turn : null} hue={hue}>
                {spread ? (
                  <TaskPin price={pin.label} face={pin.face} seed={pin.id} who={pin.who} title={pin.title} best={best} on={on} compact={!tagShown(it)} />
                ) : (
                  <PricePin price={pin.label} icon={pin.face?.icon} best={best} on={on} place={pin.area ?? 'Nearby'} hidePlace={!tagShown(it)} />
                )}
              </PinMotion>
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

/** The tile map's own soft circles and heat glow, as views (the GL map draws these with the map engine instead). */
function AreaShapes({ items, offers, hue, delays, introKey, count }: { items: MapItem[]; offers: { top: (number | null)[]; best: number | null } | null; hue: string; delays: number[]; introKey: string; count: number }) {
  // Only this fallback draws its circles as views, so only it needs the frame clock (the GL map and the phone use engine layers).
  const { elapsed } = useMapClock(introKey, introEnd(count), false);
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
            const a = areaAt(elapsed, delays[i]!);
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
    </>
  );
}
