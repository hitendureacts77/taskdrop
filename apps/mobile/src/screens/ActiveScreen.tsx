import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
  Easing,
  type TextStyle,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { markWorkDone as markWorkDoneOnServer, confirmRelease as confirmReleaseOnServer } from '../data/api';
import { workerNetPayout, posterEscrowCharge } from '@taskdrop/rules';
import { fontFamilyFor } from '../theme';

/**
 * Active task — pixel parity with docs/design/_design_markup.html lines
 * 427-498: header, circular SVG progress ring with the live HH:MM:SS timer
 * centered inside, elapsed/cap card, overrun warning, steps timeline,
 * revealed-contact card, worker proof tiles, mode-aware primary button.
 * Data/handlers mirror docs/design/_design_source.jsx lines 197-217
 * (elapsed/ringOffset/steps math) and 493-532 (doneLabel/doneNote/doneBtn).
 */

const AGREED_DURATION_SEC = 4 * 60 * 60; // "4 hrs agreed"
const RING_R = 88;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R; // ~553, matches the markup's stroke-dasharray

// Design's fallbackTask (lines 221-223), keyed by mode.
const FALLBACK_TASK = {
  worker: {
    title: 'Vintage 35mm film camera',
    price: '₹4,200',
    escrow: '₹4,326',
    payMeta: '₹4,200 to you · complete by 9 Sep, 5:00 PM',
  },
  poster: {
    title: 'Assemble a wardrobe',
    price: '₹1,200',
    escrow: '₹1,236',
    payMeta: '₹1,200 · complete by 12 Sep, 2:00 PM',
  },
} as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

/** Turn a formatted rupee string ("₹4,200") back into paise for money math. */
function parsePaise(value: string | undefined): number {
  if (!value) return 0;
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) * 100 : 0;
}

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

/** Scale-down press feedback, matching the markup's style-active="{{press}}". */
function Pressy({
  onPress,
  style,
  children,
}: {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Step = { label: string; reached: boolean };

export function ActiveScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const { mode } = useMode();
  const { openTask, doneOf, setDone, roll, balance, escrow, celebrate, flash } = useApp();
  const [busy, setBusy] = useState(false);

  const worker = mode === 'worker';
  const fallback = FALLBACK_TASK[mode];

  const title = typeof params.title === 'string' ? params.title : (openTask?.title ?? fallback.title);
  const priceStr = openTask?.price ?? fallback.price;
  const escrowStr = openTask?.escrow ?? fallback.escrow;
  const counterparty = worker ? 'the poster' : (openTask?.who ?? 'Tasker 8830 working');
  const revealedName = worker ? 'Arjun Nair' : 'Meera Rao';

  const curDone = doneOf(title);

  // Timer anchors to when the task actually started; falls back to "now" so
  // the screen still works if it's opened without going through SwipeScreen.
  const startedAtRef = useRef<number>(typeof params.startedAt === 'number' ? params.startedAt : Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsedSec = Math.max(0, Math.floor((now - startedAtRef.current) / 1000));
  const frac = Math.min(1, elapsedSec / AGREED_DURATION_SEC);
  const ringOffset = Math.round(RING_CIRCUMFERENCE * (1 - frac));

  // Animates the ring toward its target offset, ~ the markup's 0.9s cubic-bezier transition.
  const ringAnim = useRef(new Animated.Value(RING_CIRCUMFERENCE)).current;
  useEffect(() => {
    const anim = Animated.timing(ringAnim, {
      toValue: ringOffset,
      duration: 900,
      easing: Easing.bezier(0.3, 0.8, 0.3, 1),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ringOffset]);

  const steps: Step[] = [
    { label: 'Quote accepted', reached: true },
    { label: 'Escrow funded', reached: true },
    { label: 'Task started · contacts revealed', reached: true },
    { label: 'Work marked done', reached: curDone >= 1 },
    { label: 'Poster confirms · escrow released', reached: curDone >= 2 },
  ];

  const doneReady = worker ? curDone === 0 : curDone === 1;
  const doneDone = worker ? curDone >= 1 : curDone >= 2;

  const pricePaise = parsePaise(priceStr);
  const releasePaise = workerNetPayout(pricePaise);
  const escrowPaise = parsePaise(escrowStr) || posterEscrowCharge(pricePaise);

  const doneLabel = doneDone
    ? worker
      ? 'Waiting for the poster'
      : 'Escrow released'
    : worker
      ? 'Mark work done'
      : doneReady
        ? `Confirm and release ${formatINR(releasePaise)}`
        : 'Waiting on the worker';

  const doneNote = worker
    ? 'The poster confirms next. Escrow releases on their confirmation.'
    : curDone >= 2
      ? 'Funds are on their way to the worker.'
      : curDone === 1
        ? 'The worker marked this done. Confirming releases escrow to them and cannot be undone.'
        : 'You can confirm once the worker marks the job done.';

  const doneDisabled = doneDone || (!worker && !doneReady);

  const taskId = typeof params.taskId === 'string' ? params.taskId : null;

  const markDone = async () => {
    if (busy) return;
    if (doneDisabled) {
      if (worker) flash('Already marked done');
      else if (curDone === 0) flash('The worker has not marked it done yet');
      return;
    }
    setBusy(true);
    try {
      if (worker) {
        // Server opens the poster's review window and stamps work_done_at.
        if (taskId) await markWorkDoneOnServer(taskId);
        setDone(title, 1);
        celebrate('Work marked done');
      } else {
        // Server takes the commission and credits the worker's clearing balance.
        if (taskId) await confirmReleaseOnServer(taskId);
        setDone(title, 2);
        roll('balance', balance + releasePaise);
        roll('escrow', Math.max(0, escrow - escrowPaise));
        celebrate(`Escrow released · ${formatINR(releasePaise)}`);
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update this task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll padded={false}>
      <View style={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={back} hitSlop={10}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <RNText style={tx('700', 17, t.colors.ink)}>Active task</RNText>
        </View>

        <View style={{ alignItems: 'center', marginTop: 22 }}>
          <View style={{ width: 200, height: 200 }}>
            <Svg width={200} height={200} viewBox="0 0 200 200" fill="none" style={{ transform: [{ rotate: '-90deg' }] }}>
              <Circle cx={100} cy={100} r={RING_R} stroke={t.colors.surface2} strokeWidth={10} fill="none" />
              <AnimatedCircle
                cx={100}
                cy={100}
                r={RING_R}
                stroke={t.colors.accent}
                strokeWidth={10}
                strokeLinecap="round"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringAnim}
                fill="none"
              />
            </Svg>
            <View
              style={{
                position: 'absolute',
                inset: 0,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText
                style={tx('800', 36, t.colors.ink, {
                  letterSpacing: -1.08,
                  fontVariant: ['tabular-nums'],
                })}
              >
                {formatHMS(elapsedSec)}
              </RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6 })}>of 4 hrs agreed</RNText>
            </View>
          </View>
        </View>

        <View style={{ alignItems: 'center', marginTop: 20 }}>
          <RNText style={tx('800', 19, t.colors.ink, { letterSpacing: -0.38, textAlign: 'center' })}>{title}</RNText>
          <RNText
            style={tx('400', 13, t.colors.muted, { marginTop: 6, fontVariant: ['tabular-nums'], textAlign: 'center' })}
          >
            {escrowStr} in escrow · {counterparty}
          </RNText>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 18,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 14,
            padding: 15,
          }}
        >
          <View>
            <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>ELAPSED</RNText>
            <RNText
              style={tx('800', 24, t.colors.ink, {
                letterSpacing: -0.72,
                marginTop: 4,
                fontVariant: ['tabular-nums'],
              })}
            >
              {formatHMS(elapsedSec)}
            </RNText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>CAP</RNText>
            <RNText style={tx('700', 15, t.colors.gold, { marginTop: 6, fontVariant: ['tabular-nums'] })}>
              08:00:00
            </RNText>
          </View>
        </View>

        <View
          style={{
            marginTop: 12,
            backgroundColor: t.colors.goldSoft,
            borderWidth: 1,
            borderColor: t.colors.gold,
            borderRadius: 12,
            paddingVertical: 13,
            paddingHorizontal: 15,
          }}
        >
          <RNText style={tx('400', 13, t.colors.gold, { lineHeight: 20 })}>
            The timer runs on its own — neither side can pause it. It caps at 8 hrs, twice the agreed duration, and
            overrun past that is auto-refunded.
          </RNText>
        </View>

        <View style={{ marginTop: 22 }}>
          {steps.map((s) => (
            <View
              key={s.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
              }}
            >
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: s.reached ? t.colors.accent : t.colors.line,
                }}
              />
              <RNText style={tx('400', 14, t.colors.muted, { flex: 1 })}>{s.label}</RNText>
            </View>
          ))}
        </View>

        <View
          style={{
            marginTop: 22,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 13,
            paddingBottom: 18,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              backgroundColor: t.colors.surface2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('400', 16, t.colors.muted)}>☺</RNText>
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 15, t.colors.ink)}>{revealedName}</RNText>
            <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 3, fontVariant: ['tabular-nums'] })}>
              +91 98••• ••210 · revealed
            </RNText>
          </View>
          <Pressy onPress={() => go('chat', params)}>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>Chat</RNText>
          </Pressy>
        </View>

        {worker && (
          <View style={{ marginTop: 20 }}>
            <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>PROOF OF WORK</RNText>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 11 }}>
              {[0, 1].map((key) => (
                <View
                  key={key}
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 12,
                    backgroundColor: t.colors.surface2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText style={tx('400', 18, t.colors.muted)}>▤</RNText>
                </View>
              ))}
              <Pressy
                onPress={() => flash('Proof photo added')}
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: t.colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <RNText style={tx('400', 18, t.colors.muted)}>+</RNText>
                <RNText style={tx('400', 10, t.colors.muted)}>Add</RNText>
              </Pressy>
            </View>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10, lineHeight: 18 })}>
              {curDone >= 1
                ? 'Proof sent to the poster with your completion.'
                : 'Add proof before you mark the work done.'}
            </RNText>
          </View>
        )}

        <Pressy
          onPress={markDone}
          style={{
            marginTop: 20,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            backgroundColor: doneDisabled ? t.colors.surface2 : t.colors.accent,
            shadowColor: t.colors.accent,
            shadowOpacity: doneDisabled ? 0 : 0.4,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: doneDisabled ? 0 : 3,
          }}
        >
          <RNText style={tx('700', 16, doneDisabled ? t.colors.muted : t.colors.onAccent)}>{doneLabel}</RNText>
        </Pressy>
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 11, lineHeight: 18 })}>
          {doneNote}
        </RNText>
      </View>
    </Screen>
  );
}
