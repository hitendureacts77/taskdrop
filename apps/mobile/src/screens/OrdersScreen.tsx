import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp, type TaskCtx } from '../providers/AppStateProvider';
import { fontFamilyFor, type Theme } from '../theme';

/**
 * My bids / My requests — pixel parity with docs/design/_design_markup.html
 * lines 204-246 (title, sliding tab underline, order cards, empty state).
 * Data/handlers mirror docs/design/_design_source.jsx lines 138-196 (bidRows/
 * requestRows/orderRows/orderTabs). Mode-aware: workers see bids they placed,
 * posters see requests they posted.
 */

/** Tone keys shared with `useApp().myBids` so both sources render identically. */
type Tone = 'accent' | 'gold' | 'signal' | 'blue' | 'violet' | 'neutral';
type Act = 'compare' | 'quotes' | 'confirm' | 'review' | 'active' | 'start' | null;

type ViewRow = {
  bucket?: number;
  state: string;
  tone: Tone;
  title: string;
  priceLabel: string;
  priceMinor: number;
  meta: string;
  act: Act;
  escrowLabel?: string;
  who?: string;
  payMeta?: string;
};

function toneDot(tone: Tone, colors: Theme['colors']): string {
  switch (tone) {
    case 'gold':
      return colors.gold;
    case 'signal':
      return colors.signal;
    case 'blue':
      return colors.blue;
    case 'violet':
      return colors.purple;
    case 'accent':
      return colors.accent;
    default:
      return colors.muted;
  }
}

function toneInk(tone: Tone, colors: Theme['colors']): string {
  switch (tone) {
    case 'gold':
      return colors.gold;
    case 'signal':
      return colors.signalDeep;
    case 'blue':
      return colors.blue;
    case 'violet':
      return colors.purple;
    case 'accent':
      return colors.accentDeep;
    default:
      return colors.muted;
  }
}

/** Bucket-index rule from the design: an explicit bucket wins, otherwise the
 * status text is classified per-mode. Mirrors `_design_source.jsx` lines 162-174. */
function bucketOf(row: { bucket?: number; state: string }, worker: boolean): number {
  if (typeof row.bucket === 'number') return row.bucket;
  const s = row.state;
  if (worker) {
    if (/LISTING|QUOTES ON MY SERVICE/.test(s)) return 0;
    if (/ACCEPTED|ACTIVE|WORK DONE/.test(s)) return 1;
    if (/PENDING/.test(s)) return 2;
    return 3;
  }
  if (/OPEN|PENDING/.test(s)) return 0;
  if (/ACTIVE/.test(s)) return 1;
  return 2;
}

const WORKER_TABS = ['Listings', 'Accepted', 'Pending', 'Closed'];
const POSTER_TABS = ['Open', 'Active', 'Done'];

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

/** Fades + slides content in on mount, ~ the markup's tdFade/tdIn keyframes. Cleans up on unmount. */
function FadeIn({
  children,
  duration = 260,
  delay = 0,
  translateY = 0,
  style,
}: {
  children: React.ReactNode;
  duration?: number;
  delay?: number;
  translateY?: number;
  style?: ViewStyle;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(translateY)).current;
  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, delay, useNativeDriver: true }),
      Animated.timing(ty, { toValue: 0, duration, delay, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: ty }] }]}>{children}</Animated.View>
  );
}

/** Scale-down press feedback, matching the markup's style-active="{{cardPress}}". */
function Pressy({
  onPress,
  scaleTo = 0.985,
  style,
  children,
}: {
  onPress?: () => void;
  scaleTo?: number;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, { transform: [{ scale: pressed ? scaleTo : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}

/** Tab row with a sliding underline, ~ markup lines 208-214 (underline calc in
 * `_design_source.jsx` lines 351-356: width (100%-40px)/n, left 20px + that*index). */
function OrderTabs({
  tabs,
  active,
  onPick,
  t,
}: {
  tabs: string[];
  active: number;
  onPick: (i: number) => void;
  t: Theme;
}) {
  const [width, setWidth] = useState(0);
  const trackWidth = Math.max(0, width - 40);
  const underlineWidth = tabs.length ? trackWidth / tabs.length : 0;
  const left = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    const anim = Animated.timing(left, {
      toValue: 20 + underlineWidth * active,
      duration: 300,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [active, underlineWidth, left]);

  return (
    <View
      style={{ flexDirection: 'row', paddingHorizontal: 20, position: 'relative' }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {tabs.map((label, i) => {
        const isActive = active === i;
        return (
          <Pressable
            key={label}
            onPress={() => onPick(i)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}
          >
            <RNText style={tx(isActive ? '700' : '600', 13, isActive ? t.colors.ink : t.colors.muted)}>
              {label}
            </RNText>
          </Pressable>
        );
      })}
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 0, height: 2, backgroundColor: t.colors.line }} />
      <Animated.View
        style={{ position: 'absolute', left, bottom: 0, height: 2, width: underlineWidth, backgroundColor: t.colors.ink }}
      />
    </View>
  );
}

function OrderCard({
  row,
  index,
  onOpen,
  t,
}: {
  row: ViewRow;
  index: number;
  onOpen: () => void;
  t: Theme;
}) {
  return (
    <FadeIn duration={360} delay={index * 70} translateY={10} style={{ marginTop: 12 }}>
      <Pressy
        onPress={onOpen}
        scaleTo={0.985}
        style={{
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.line,
          borderRadius: 14,
          padding: 15,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: toneDot(row.tone, t.colors),
            }}
          />
          <RNText style={tx('700', 10, toneInk(row.tone, t.colors), { letterSpacing: 1.6 })}>{row.state}</RNText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 9 }}>
          <RNText style={tx('700', 16, t.colors.ink, { flex: 1 })}>{row.title}</RNText>
          <RNText style={tx('800', 16, t.colors.ink)}>{row.priceLabel}</RNText>
        </View>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6 })}>{row.meta}</RNText>
      </Pressy>
    </FadeIn>
  );
}

/** Empty-state illustration copied from the markup's inline svg (lines 231-237) — no emoji. */
function EmptyBoxIcon({ t }: { t: Theme }) {
  return (
    <Svg width={120} height={96} viewBox="0 0 120 96" fill="none" opacity={0.75}>
      <Path d="M30 40h44v40H30z" stroke={t.colors.muted} strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M42 56h20" stroke={t.colors.muted} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M34 40 42 26h20l8 14" stroke={t.colors.muted} strokeWidth={2.2} strokeLinejoin="round" />
      <Circle cx={88} cy={66} r={8} stroke={t.colors.accent} strokeWidth={2.2} />
      <Path d="M18 80h84" stroke={t.colors.muted} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function OrdersScreen() {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();
  const { myBids, flash, setOpenTask, doneOf, startedOf } = useApp();
  const [orderTab, setOrderTab] = useState(0);

  const worker = mode === 'worker';

  // Sample rows straight from the design (_design_source.jsx lines 138-159), with
  // amounts converted to paise per the app's money contract.
  const designRows: ViewRow[] = useMemo(() => {
    if (worker) {
      const title = 'Vintage 35mm film camera';
      const started = startedOf(title);
      const done = doneOf(title);
      return [
        {
          bucket: 1,
          state: done >= 1 ? 'WORK DONE · AWAITING POSTER' : started ? 'ACTIVE · TIMER RUNNING' : 'ACCEPTED · SWIPE TO START',
          tone: started ? 'gold' : 'accent',
          title,
          priceLabel: formatINR(420000),
          priceMinor: 420000,
          meta: done >= 1 ? 'Work marked done · poster confirms next' : started ? 'Task started · timer running' : 'Escrow funded · first to start wins',
          act: 'start',
          escrowLabel: formatINR(433500),
          who: 'you are working',
          payMeta: `${formatINR(420000)} to you · complete by 9 Sep, 5:00 PM`,
        },
        {
          bucket: 2,
          state: 'PENDING',
          tone: 'blue',
          title: 'Fix leaking kitchen tap',
          priceLabel: formatINR(55000),
          priceMinor: 55000,
          meta: 'Sent 2 hrs ago · 4 quotes total',
          act: null,
        },
        {
          bucket: 0,
          state: 'QUOTES ON MY SERVICE · 3 NEW',
          tone: 'violet',
          title: 'Bespoke carpentry and joinery',
          priceLabel: formatINR(120000),
          priceMinor: 120000,
          meta: 'Posters sent quotes · lock one to take it',
          act: 'quotes',
        },
        {
          bucket: 3,
          state: 'NOT SELECTED',
          tone: 'neutral',
          title: 'Airport pickup, 6 AM',
          priceLabel: formatINR(90000),
          priceMinor: 90000,
          meta: 'Another worker started first',
          act: null,
        },
      ];
    }
    return [
      {
        state: 'OPEN · 12 QUOTES',
        tone: 'blue',
        title: 'Vintage 35mm film camera',
        priceLabel: formatINR(450000),
        priceMinor: 450000,
        meta: 'Complete by 9 Sep, 6:00 PM · tap to compare',
        act: 'compare',
        escrowLabel: formatINR(433500),
        who: 'not started',
        payMeta: `${formatINR(450000)} · complete by 9 Sep, 6:00 PM`,
      },
      {
        state: 'ACTIVE · TIMER RUNNING',
        tone: 'gold',
        title: 'Assemble a wardrobe',
        priceLabel: formatINR(120000),
        priceMinor: 120000,
        meta: 'Tasker 8830 started 2 hrs ago',
        act: 'active',
        escrowLabel: formatINR(123600),
        who: 'Tasker 8830 working',
        payMeta: `${formatINR(120000)} · complete by 12 Sep, 2:00 PM`,
      },
      {
        bucket: 1,
        state: 'MARKED DONE · CONFIRM TO RELEASE',
        tone: 'gold',
        title: 'Photograph a flat before I rent it',
        priceLabel: formatINR(45000),
        priceMinor: 45000,
        meta: 'Proof uploaded 1 hr ago · tap to review',
        act: 'confirm',
        escrowLabel: formatINR(46300),
        who: 'Tasker 8830 working',
        payMeta: `${formatINR(45000)} · complete by 11 Sep, 11:00 AM`,
      },
      {
        state: 'DONE · RELEASED',
        tone: 'accent',
        title: 'Fix leaking kitchen tap',
        priceLabel: formatINR(60000),
        priceMinor: 60000,
        meta: 'Confirmed 3 Sep · tap to review the worker',
        act: 'review',
      },
    ];
  }, [worker, doneOf, startedOf]);

  const myBidRows: ViewRow[] = useMemo(
    () =>
      myBids
        .filter((r) => r.role === mode)
        .map((r) => ({
          bucket: r.bucket,
          state: r.state,
          tone: (r.tone ?? 'neutral') as Tone,
          title: r.title,
          priceLabel: r.price,
          priceMinor: 0,
          meta: r.meta,
          act: null,
        })),
    [myBids, mode],
  );

  const allRows = useMemo(() => designRows.concat(myBidRows), [designRows, myBidRows]);

  const tabNames = worker ? WORKER_TABS : POSTER_TABS;
  const orderRows = useMemo(
    () => allRows.filter((r) => bucketOf(r, worker) === orderTab),
    [allRows, worker, orderTab],
  );

  const openRow = (row: ViewRow) => {
    if (row.act === 'compare') {
      const task: TaskCtx = { title: row.title, price: row.priceLabel, escrow: row.escrowLabel, who: row.who, payMeta: row.payMeta };
      setOpenTask(task);
      go('compare', { title: row.title, priceMinor: row.priceMinor });
      return;
    }
    if (row.act === 'quotes') {
      go('myQuotes');
      return;
    }
    if (row.act === 'confirm') {
      const task: TaskCtx = { title: row.title, price: row.priceLabel, escrow: row.escrowLabel, who: row.who, payMeta: row.payMeta };
      setOpenTask(task);
      go('confirm', { title: row.title, priceMinor: row.priceMinor });
      return;
    }
    if (row.act === 'review') {
      setOpenTask({ title: row.title, price: row.priceLabel, escrow: row.priceLabel, who: 'done', payMeta: row.priceLabel });
      go('review', { title: row.title });
      return;
    }
    const task: TaskCtx = { title: row.title, price: row.priceLabel, escrow: row.escrowLabel, who: row.who, payMeta: row.payMeta };
    if (row.act === 'start') {
      setOpenTask(task);
      if (startedOf(row.title)) go('active', { title: row.title });
      else go('swipe', { title: row.title });
      return;
    }
    if (row.act === 'active') {
      setOpenTask(task);
      go('active', { title: row.title });
      return;
    }
    flash(`${row.title} · ${row.priceLabel}`);
  };

  const emptyLine = worker ? 'Quotes you send show up here.' : 'Requests you post show up here.';

  return (
    <Screen scroll padded={false}>
      <FadeIn duration={260}>
        <RNText
          style={tx('800', 24, t.colors.ink, {
            letterSpacing: -0.72,
            paddingTop: 6,
            paddingHorizontal: 20,
            paddingBottom: 14,
          })}
        >
          {worker ? 'My bids' : 'My requests'}
        </RNText>

        <OrderTabs tabs={tabNames} active={orderTab} onPick={setOrderTab} t={t} />

        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 }}>
          {orderRows.map((row, i) => (
            <OrderCard key={`${row.title}-${i}`} row={row} index={i} onOpen={() => openRow(row)} t={t} />
          ))}

          {orderRows.length === 0 && (
            <FadeIn duration={400} style={{ paddingVertical: 70, alignItems: 'center' }}>
              <EmptyBoxIcon t={t} />
              <RNText style={tx('800', 18, t.colors.ink, { marginTop: 20 })}>Nothing here yet</RNText>
              <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21, textAlign: 'center' })}>
                {emptyLine}
              </RNText>
              <Pressy onPress={() => go('home')} scaleTo={0.96} style={{ marginTop: 20 }}>
                <RNText style={tx('700', 14, t.colors.ink, { textDecorationLine: 'underline' })}>Browse the feed</RNText>
              </Pressy>
            </FadeIn>
          )}
        </View>
      </FadeIn>
    </Screen>
  );
}
