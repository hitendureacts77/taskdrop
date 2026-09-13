import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
  type TextStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { startTask as startTaskOnServer } from '../data/api';
import { fontFamilyFor } from '../theme';

/**
 * Swipe to start — pixel parity with docs/design/_design_markup.html lines
 * 397-426 (quote-locked banner, shield/checkmark card, drag track). Data/
 * handlers mirror docs/design/_design_source.jsx lines 456-491 (swipeFill/
 * swipeKnob/swipeHint/swipeUp). Keeps the PanResponder drag-to-start gesture:
 * releasing past 90% calls startTask + celebrate + go('active').
 */

const KNOB = 50;
const TRACK_PAD = 6;
const RELEASE_THRESHOLD = 0.9;

// Design's fallback openTask when the nav stack didn't carry one (lines 221-224).
const FALLBACK_TASK = {
  title: 'Assemble a wardrobe',
  payMeta: '₹1,200 · complete by 12 Sep, 2:00 PM',
};

const AnimatedPath = Animated.createAnimatedComponent(Path);

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

/** Fades content in on mount, ~ the markup's tdFade keyframe. */
function FadeIn({ children, duration = 260 }: { children: React.ReactNode; duration?: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [opacity, duration]);
  return <Animated.View style={{ flex: 1, opacity }}>{children}</Animated.View>;
}

export function SwipeScreen() {
  const t = useTheme();
  const { params, go, back } = useNav();
  const { openTask, startTask, celebrate, flash } = useApp();

  const title =
    typeof params.title === 'string'
      ? params.title
      : (openTask?.title ?? FALLBACK_TASK.title);
  const payMeta =
    typeof params.payMeta === 'string'
      ? params.payMeta
      : (openTask?.payMeta ?? FALLBACK_TASK.payMeta);

  const [trackWidth, setTrackWidth] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1, live drag position
  const [started, setStarted] = useState(false);

  // PanResponder.create() runs once (inside useRef's initializer), so its
  // callbacks close over whatever state existed at that first render. Any
  // value the gesture handlers need must be read through a ref, not state.
  const trackWidthRef = useRef(0);
  const progressRef = useRef(0);
  const grantProgressRef = useRef(0);
  const startedRef = useRef(false);
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Draws the checkmark inside the shield icon, ~ the markup's tdDraw keyframe
  // (stroke-dashoffset 60 -> 0, 0.7s ease-out, 0.2s delay).
  const drawAnim = useRef(new Animated.Value(60)).current;
  useEffect(() => {
    const anim = Animated.timing(drawAnim, {
      toValue: 0,
      duration: 700,
      delay: 200,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [drawAnim]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);
  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  useEffect(() => {
    return () => {
      if (navTimeoutRef.current != null) clearTimeout(navTimeoutRef.current);
    };
  }, []);

  const maxTravelFor = (width: number) => Math.max(1, width - KNOB - TRACK_PAD * 2);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !startedRef.current,
      onMoveShouldSetPanResponder: () => !startedRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        grantProgressRef.current = progressRef.current;
      },
      onPanResponderMove: (_e: GestureResponderEvent, gesture: PanResponderGestureState) => {
        if (startedRef.current) return;
        const travel = maxTravelFor(trackWidthRef.current);
        const next = clamp(grantProgressRef.current + gesture.dx / travel, 0, 1);
        // Keep the ref in lock-step synchronously: onPanResponderRelease reads it,
        // and a fast flick can release before the state-sync effect has run.
        progressRef.current = next;
        setProgress(next);
      },
      onPanResponderRelease: () => {
        if (startedRef.current) return;
        if (progressRef.current > RELEASE_THRESHOLD) {
          setProgress(1);
          setStarted(true);
          startTask(title);
          const taskId = typeof params.taskId === 'string' ? params.taskId : null;
          if (taskId) {
            // First worker to reach TASK_STARTED wins; the server decides.
            startTaskOnServer(taskId)
              .then(() => celebrate('Task started · contacts revealed'))
              .catch((e: unknown) => {
                setStarted(false);
                setProgress(0);
                flash(e instanceof Error ? e.message : 'Could not start this task');
              });
          } else {
            celebrate('Task started · contacts revealed');
          }
          navTimeoutRef.current = setTimeout(() => go('active', params), 220);
        } else {
          setProgress(0);
        }
      },
    }),
  ).current;

  const released = progress > RELEASE_THRESHOLD || started;
  const fillPct = clamp(12 + progress * 88, 12, 100);
  const maxTravel = maxTravelFor(trackWidth);
  const knobX = progress * maxTravel;
  const labelOpacity = clamp(1 - progress * 1.6, 0, 1);
  const hint = released ? 'Release to start' : 'Slide the handle all the way across.';

  return (
    <Screen padded={false}>
      <FadeIn>
        <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 28 }}>
          <View style={{ paddingTop: 6 }}>
            <Pressable onPress={back} hitSlop={10}>
              <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
            </Pressable>
          </View>

          <View style={{ flex: 1, justifyContent: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: t.colors.accent }} />
              <RNText style={tx('700', 10, t.colors.accentDeep, { letterSpacing: 1.6 })}>
                QUOTE LOCKED · ESCROW FUNDED
              </RNText>
            </View>
            <RNText style={tx('800', 29, t.colors.ink, { letterSpacing: -1.02, marginTop: 14, lineHeight: 35 })}>
              {title}
            </RNText>
            <RNText style={tx('400', 15, t.colors.muted, { marginTop: 10 })}>{payMeta}</RNText>

            <View
              style={{
                marginTop: 26,
                backgroundColor: t.colors.accentSoft,
                borderWidth: 1,
                borderColor: t.colors.accentBorder,
                borderRadius: 14,
                padding: 16,
                flexDirection: 'row',
                gap: 12,
              }}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z"
                  stroke={t.colors.accent}
                  strokeWidth={1.7}
                  strokeLinejoin="round"
                />
                <AnimatedPath
                  d="m9 12 2.2 2.2L15.5 10"
                  stroke={t.colors.accent}
                  strokeWidth={1.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={60}
                  strokeDashoffset={drawAnim}
                />
              </Svg>
              <RNText style={tx('400', 13, t.colors.accentDeep, { flex: 1, lineHeight: 20 })}>
                Starting reveals both contacts and begins the live timer. It cannot be paused.
              </RNText>
            </View>
          </View>

          <View>
            <View
              onLayout={(e) => {
                trackWidthRef.current = e.nativeEvent.layout.width;
                setTrackWidth(e.nativeEvent.layout.width);
              }}
              {...panResponder.panHandlers}
              style={{
                height: 62,
                borderRadius: 999,
                backgroundColor: t.colors.surface2,
                borderWidth: 1,
                borderColor: t.colors.line,
                flexDirection: 'row',
                alignItems: 'center',
                padding: TRACK_PAD,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${fillPct}%`,
                  backgroundColor: t.colors.accentSoft,
                }}
              />
              <View
                style={{
                  width: KNOB,
                  height: KNOB,
                  borderRadius: KNOB / 2,
                  backgroundColor: t.colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ translateX: knobX }],
                  shadowColor: t.colors.accent,
                  shadowOpacity: 0.4,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 4,
                }}
              >
                <RNText style={tx('800', 19, t.colors.onAccent)}>{released ? '✓' : '→'}</RNText>
              </View>
              <RNText
                style={tx('700', 15, t.colors.ink, {
                  flex: 1,
                  textAlign: 'center',
                  paddingRight: 50,
                  opacity: labelOpacity,
                })}
              >
                Swipe to start
              </RNText>
            </View>
            <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 13 })}>{hint}</RNText>
          </View>
        </View>
      </FadeIn>
    </Screen>
  );
}
