import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Linking, PanResponder, Platform, Pressable, View, Text as RNText, useWindowDimensions } from 'react-native';
import { Icon } from './Icon';
import { HeroBackground } from './Hero';
import { tx } from './primitives';
import { PersonTheme, useTheme } from '../providers/ThemeProvider';
import { useLayout } from '../lib/layout';
import { useReducedMotion } from '../lib/motion';
import {
  swipeDirection,
  tapHalf,
  videoUrl,
  walkAnnouncement,
  walkStepClamp,
  WALK_AUTOPLAY_MS,
  WALK_COPY,
  WALK_STEP_LAST,
  WALK_STEPS,
  WALKTHROUGH_VIDEO_LABEL,
  WALKTHROUGH_VIDEO_NOTE,
  type WalkSide,
} from '../lib/walkthrough';

/** The ten real app screens (taken from the app at phone width with fake staging people). */
const SHOTS: Record<string, number> = {
  h1: require('../../assets/walkthrough/h1.jpg'),
  h2: require('../../assets/walkthrough/h2.jpg'),
  h3: require('../../assets/walkthrough/h3.jpg'),
  h4: require('../../assets/walkthrough/h4.jpg'),
  h5: require('../../assets/walkthrough/h5.jpg'),
  e1: require('../../assets/walkthrough/e1.jpg'),
  e2: require('../../assets/walkthrough/e2.jpg'),
  e3: require('../../assets/walkthrough/e3.jpg'),
  e4: require('../../assets/walkthrough/e4.jpg'),
  e5: require('../../assets/walkthrough/e5.jpg'),
};
/** Width / height of every screenshot. The screen box of a phone mock always has exactly this shape. */
const SHOT_RATIO = 488 / 835;
const NATIVE = Platform.OS !== 'web';
const HOLD_MS = 250;

function openVideo(url: string) {
  Linking.openURL(url).catch(() => {
    /* no browser or YouTube app: nothing else to do */
  });
}

/** Props that only react-native-web understands (hover). Typed loosely on purpose. */
function hoverProps(on: () => void, off: () => void): object {
  return Platform.OS === 'web' ? { onMouseEnter: on, onMouseLeave: off } : {};
}

/** The five screens plus the clock that moves them along. */
function useWalk(startSide: WalkSide) {
  const [side, setSide] = useState<WalkSide>(startSide);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [hold, setHold] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const at = useRef(0);
  const lastKey = useRef('');
  const paused = !playing || hover || hold;
  const key = `${side}:${i}`;

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      at.current = value;
    });
    return () => progress.removeListener(id);
  }, [progress]);

  // Announce the step to screen readers (not the very first one).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    AccessibilityInfo.announceForAccessibility(walkAnnouncement(side, i + 1));
  }, [side, i]);

  // One step plays WALK_AUTOPLAY_MS; pausing keeps the part already played. The last step stops.
  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      progress.setValue(0);
      at.current = 0;
    }
    if (paused) return;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(0, (1 - at.current) * WALK_AUTOPLAY_MS),
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished && i < WALK_STEP_LAST) setI((n) => walkStepClamp(n, 1));
    });
    return () => anim.stop();
  }, [key, paused, progress, i]);

  const step = useCallback((d: number) => setI((n) => walkStepClamp(n, d)), []);
  const jump = useCallback((n: number) => setI(walkStepClamp(n, 0)), []);
  const pick = useCallback((s: WalkSide) => {
    setSide(s);
    setI(0);
    setPlaying(true);
  }, []);
  return { side, i, playing, setPlaying, setHover, setHold, progress, step, jump, pick };
}

type Walk = ReturnType<typeof useWalk>;

/** Hire (jade) and Earn (royal blue): each pill wears its own person's colour. */
function SideSwitch({ side, onChange, labels, compact }: { side: WalkSide; onChange: (s: WalkSide) => void; labels: [string, string]; compact?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: t.colors.surface2 }}>
      {(['hire', 'earn'] as const).map((k, n) => (
        <PersonTheme key={k} role={k === 'hire' ? 'poster' : 'worker'}>
          <SidePill on={side === k} label={labels[n]} short={k === 'hire' ? 'Hire' : 'Earn'} onPress={() => onChange(k)} compact={compact} />
        </PersonTheme>
      ))}
    </View>
  );
}

function SidePill({ on, label, short, onPress, compact }: { on: boolean; label: string; short: string; onPress: () => void; compact?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${short} side`}
      style={{ alignItems: 'center', paddingVertical: compact ? 7 : 9, paddingHorizontal: compact ? 14 : 18, borderRadius: 999, backgroundColor: on ? t.colors.btn : 'transparent' }}
    >
      <RNText style={tx('800', 13.5, on ? t.colors.onBtn : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );
}

/** Five bars; finished steps are full, the current one fills as it plays. */
function Segments({ i, progress, reduced, height = 4 }: { i: number; progress: Animated.Value; reduced: boolean; height?: number }) {
  const t = useTheme();
  const fill = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2, 3, 4].map((n) => (
        <View key={n} style={{ flex: 1, height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: t.colors.line }}>
          {n < i ? (
            <View style={{ width: '100%', height: '100%', backgroundColor: t.colors.accent }} />
          ) : n === i ? (
            reduced ? (
              <View style={{ width: '100%', height: '100%', backgroundColor: t.colors.accent }} />
            ) : (
              <Animated.View style={{ width: fill, height: '100%', backgroundColor: t.colors.accent }} />
            )
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * One real screenshot, drawn whole: the box has exactly the picture's shape, `contain`, and only the opacity
 * changes between steps (no zoom, no crop, owner rule).
 */
function Shot({ shot, label, width, reduced }: { shot: string; label: string; width: number | string; reduced: boolean }) {
  const [cur, setCur] = useState(shot);
  const [prev, setPrev] = useState<string | null>(null);
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (shot === cur) return;
    if (reduced) {
      setCur(shot);
      setPrev(null);
      return;
    }
    setPrev(cur);
    setCur(shot);
    op.setValue(0);
    Animated.timing(op, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start(() => setPrev(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new picture starts a fade
  }, [shot, reduced]);
  const fill = { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' } as const;
  return (
    <View style={{ width: width as number, aspectRatio: SHOT_RATIO, backgroundColor: '#FFFFFF', overflow: 'hidden' }}>
      {prev ? <Animated.Image source={SHOTS[prev]} resizeMode="contain" style={fill} /> : null}
      <Animated.Image source={SHOTS[cur]} accessibilityLabel={label} resizeMode="contain" style={[fill, { opacity: op }]} />
    </View>
  );
}

/** Soft rings spreading from the phone. Static when the person asked for reduced motion. */
function Ripples({ reduced }: { reduced: boolean }) {
  const vals = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduced) return;
    const loops = vals.map((v, n) => {
      const l = Animated.loop(Animated.timing(v, { toValue: 1, duration: 4200, delay: n * 1400, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }));
      l.start();
      return l;
    });
    return () => loops.forEach((l) => l.stop());
  }, [reduced, vals]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      {vals.map((v, n) => (
        <Animated.View
          key={n}
          style={{
            position: 'absolute',
            width: 420,
            height: 420,
            borderRadius: 210,
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.5)',
            opacity: reduced ? 0.18 - n * 0.04 : v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }),
            transform: [{ scale: reduced ? 0.8 + n * 0.3 : v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) }],
          }}
        />
      ))}
    </View>
  );
}

function VideoButton({ url, label = WALKTHROUGH_VIDEO_LABEL, dark }: { url: string; label?: string; dark?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => openVideo(url)}
      accessibilityRole="link"
      accessibilityLabel={`${label}, ${WALKTHROUGH_VIDEO_NOTE}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: dark ? t.colors.line : t.colors.accent }}
    >
      <Icon name="play" size={14} color={t.colors.accentDeep} />
      <RNText style={tx('800', 13.5, t.colors.accentDeep)}>{label}</RNText>
    </Pressable>
  );
}

type CtaRef = { current: unknown };

function Cta({ side, onFinish, ctaRef, grow }: { side: WalkSide; onFinish: (s: WalkSide) => void; ctaRef?: CtaRef; grow?: boolean }) {
  const t = useTheme();
  const label = side === 'hire' ? WALK_COPY.goHire : WALK_COPY.goEarn;
  return (
    <Pressable
      ref={ctaRef as never}
      onPress={() => onFinish(side)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: 28,
        borderRadius: 999,
        backgroundColor: t.colors.btn,
        alignItems: 'center',
        justifyContent: 'center',
        flexGrow: grow ? 1 : 0,
        transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
      })}
    >
      <RNText style={tx('800', 15.5, t.colors.onBtn)}>{label}</RNText>
    </Pressable>
  );
}

/**
 * "How TaskDrop works": its own full page (task 1.21 row X). Five real screens per side that play by
 * themselves, 5 seconds each. Desktop and tablet: a big phone on a coloured panel and the steps beside it.
 * Phone: story mode (tap right = next, tap left = back, swipe, hold to pause, no buttons).
 * `extra` sits under the call to action (the first-run intro puts "Create my account" there).
 */
export function Walkthrough({
  side: startSide,
  onSkip,
  onFinish,
  skipLabel = WALK_COPY.skip,
  extra,
}: {
  side: WalkSide;
  /** Skip (first run) or close (replay). */
  onSkip: () => void;
  /** The call to action: "Post a request" on Hire, "Find work" on Earn. */
  onFinish: (side: WalkSide) => void;
  /** Left top label on wide screens: "Skip" on first run, "Back to Home" on a replay. */
  skipLabel?: string;
  extra?: React.ReactNode;
}) {
  const layout = useLayout();
  const reduced = useReducedMotion();
  const w = useWalk(startSide);
  const wide = layout.desktop || layout.tablet;

  // Arrow keys on the web, both layouts.
  const { step } = w;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [step]);

  return (
    <PersonTheme role={w.side === 'hire' ? 'poster' : 'worker'}>
      {wide ? (
        <WideView w={w} reduced={reduced} onSkip={onSkip} onFinish={onFinish} leftLabel={skipLabel} extra={extra} layoutW={layout.width} layoutH={layout.height} tablet={!layout.desktop} />
      ) : (
        <PhoneView w={w} reduced={reduced} onSkip={onSkip} onFinish={onFinish} extra={extra} />
      )}
    </PersonTheme>
  );
}

function WideView({
  w,
  reduced,
  onSkip,
  onFinish,
  leftLabel,
  extra,
  layoutW,
  layoutH,
  tablet,
}: {
  w: Walk;
  reduced: boolean;
  onSkip: () => void;
  onFinish: (s: WalkSide) => void;
  leftLabel: string;
  extra?: React.ReactNode;
  layoutW: number;
  layoutH: number;
  tablet: boolean;
}) {
  const t = useTheme();
  const { side, i } = w;
  const steps = WALK_STEPS[side];
  const cur = steps[i];
  const video = videoUrl();
  const last = i === WALK_STEP_LAST;
  const cta = useRef<{ focus?: () => void } | null>(null);
  // On the last step the call to action takes the focus (web).
  useEffect(() => {
    if (last && Platform.OS === 'web') cta.current?.focus?.();
  }, [last, side]);

  // The real height the page gets (the staging strip above takes a little of the window).
  const [pageH, setPageH] = useState(layoutH);
  const topH = 68;
  const bodyH = Math.max(480, pageH - topH);
  const panelW = layoutW / 2 - 40;
  // The phone's screen: exactly the screenshot's shape, as big as the panel allows.
  const screenH = Math.max(340, Math.min(bodyH - 120, (panelW - 70) / SHOT_RATIO, 760));
  const screenW = screenH * SHOT_RATIO;

  return (
    <View style={{ width: '100%', flex: 1, minHeight: 0, backgroundColor: t.colors.bg }} onLayout={(e) => setPageH(e.nativeEvent.layout.height)}>
      <View style={{ height: topH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel={leftLabel} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 }}>
            {leftLabel === WALK_COPY.backHome ? <Icon name="back" size={18} color={t.colors.muted} /> : null}
            <RNText style={tx('700', 14.5, t.colors.muted)}>{leftLabel}</RNText>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
          {tablet ? null : (
            <RNText accessibilityRole="header" style={tx('800', 18, t.colors.ink, { letterSpacing: -0.3 })}>{WALK_COPY.header}</RNText>
          )}
          <SideSwitch side={side} onChange={w.pick} labels={[WALK_COPY.wantHire, WALK_COPY.wantEarn]} compact />
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
          {video ? <VideoButton url={video} dark /> : null}
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel={WALK_COPY.close}
            hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={18} color={t.colors.ink} />
          </Pressable>
        </View>
      </View>
      {tablet ? <RNText accessibilityRole="header" style={{ height: 0, width: 0, opacity: 0 }}>{WALK_COPY.header}</RNText> : null}

      <View style={{ flex: 1, flexDirection: 'row', padding: 16, gap: 16 }}>
        <View style={{ flex: 1, borderRadius: 28, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
          <HeroBackground radius={28} />
          <Ripples reduced={reduced} />
          <View
            style={{ padding: 10, borderRadius: 46, backgroundColor: '#0E1110', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 18 } }}
            // Pause only while the pointer rests on the phone: on a desktop the pointer is always somewhere on the page.
            {...hoverProps(() => w.setHover(true), () => w.setHover(false))}
          >
            <View style={{ borderRadius: 36, overflow: 'hidden', width: screenW }}>
              <Shot shot={cur.shot} width={screenW} label={`TaskDrop screen: ${cur.title}`} reduced={reduced} />
            </View>
          </View>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: tablet ? 20 : 48, maxWidth: 700 }}>
          <Segments i={i} progress={w.progress} reduced={reduced} />
          <RNText style={tx('800', 12.5, t.colors.accent, { letterSpacing: 1, marginTop: 22, textTransform: 'uppercase' })}>{`Step ${i + 1} of 5`}</RNText>
          <RNText accessibilityRole="header" style={tx('800', tablet ? 34 : 44, t.colors.ink, { letterSpacing: -1.4, lineHeight: tablet ? 40 : 50, marginTop: 6 })}>{cur.title}</RNText>
          <RNText style={tx('700', tablet ? 19 : 21, t.colors.accentDeep, { lineHeight: tablet ? 26 : 29, marginTop: 10 })}>{cur.purpose}</RNText>
          <RNText style={tx('400', 18, t.colors.muted, { lineHeight: 27, marginTop: 12, minHeight: 54 })}>{cur.body}</RNText>

          <View style={{ marginTop: 20, gap: 4 }}>
            {steps.map((s, n) => {
              const on = n === i;
              return (
                <Pressable
                  key={s.shot}
                  onPress={() => w.jump(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`Step ${n + 1}: ${s.title}`}
                  accessibilityState={{ selected: on }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14, backgroundColor: on ? t.colors.accentSoft : 'transparent' }}
                >
                  <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.colors.btn : t.colors.surface2 }}>
                    <RNText style={tx('800', 12.5, on ? t.colors.onBtn : t.colors.muted)}>{n + 1}</RNText>
                  </View>
                  <RNText style={tx(on ? '800' : '600', 15.5, on ? t.colors.accentDeep : t.colors.ink)}>{s.title}</RNText>
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <RoundBtn label={WALK_COPY.prev} onPress={() => w.step(-1)} disabled={i === 0}>
              <Icon name="back" size={18} color={t.colors.ink} />
            </RoundBtn>
            <RoundBtn label={w.playing ? WALK_COPY.pause : WALK_COPY.play} onPress={() => w.setPlaying(!w.playing)}>
              {w.playing ? (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <View style={{ width: 4, height: 15, borderRadius: 2, backgroundColor: t.colors.ink }} />
                  <View style={{ width: 4, height: 15, borderRadius: 2, backgroundColor: t.colors.ink }} />
                </View>
              ) : (
                <Icon name="play" size={16} color={t.colors.ink} />
              )}
            </RoundBtn>
            <RoundBtn label={WALK_COPY.nextStep} onPress={() => w.step(1)} disabled={last}>
              <Icon name="chevronRight" size={18} color={t.colors.ink} />
            </RoundBtn>
            <RNText style={tx('600', 13, t.colors.muted)}>{WALK_COPY.hintAuto}</RNText>
          </View>
          <View style={{ marginTop: 18, alignItems: 'flex-start', gap: 8 }}>
            <Cta side={side} onFinish={onFinish} ctaRef={cta} />
            {extra}
          </View>
        </View>
      </View>
    </View>
  );
}

function RoundBtn({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: t.colors.line, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      {children}
    </Pressable>
  );
}

function PhoneView({ w, reduced, onSkip, onFinish, extra }: { w: Walk; reduced: boolean; onSkip: () => void; onFinish: (s: WalkSide) => void; extra?: React.ReactNode }) {
  const t = useTheme();
  const { width: winW } = useWindowDimensions();
  const { side, i } = w;
  const cur = WALK_STEPS[side][i];
  const video = videoUrl();
  const [touched, setTouched] = useState(false);
  // The space left between the top row and the caption card. The picture is fitted inside it whole, at the
  // screenshot's own shape, so it is never taller than the phone, stretched, or hidden under the card (owner, 28 Nov).
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const shotW = area ? Math.max(120, Math.min(area.w - 48, (area.h - 20) * SHOT_RATIO)) : 0;
  const hint = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (touched) Animated.timing(hint, { toValue: 0, duration: reduced ? 0 : 400, useNativeDriver: NATIVE }).start();
  }, [touched, hint, reduced]);

  const stepRef = useRef(w.step);
  stepRef.current = w.step;
  const widthRef = useRef(winW);
  widthRef.current = winW;
  const setHold = w.setHold;
  const pan = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let held = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (held) setHold(false);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        held = false;
        timer = setTimeout(() => {
          held = true;
          setHold(true);
        }, HOLD_MS);
      },
      onPanResponderRelease: (_e, g) => {
        const wasHeld = held;
        clear();
        setTouched(true);
        const dir = swipeDirection(g.dx);
        if (dir) stepRef.current(dir === 'next' ? 1 : -1);
        else if (!wasHeld && Math.abs(g.dx) < 14 && Math.abs(g.dy) < 14) stepRef.current(tapHalf(g.x0, widthRef.current) === 'next' ? 1 : -1);
      },
      onPanResponderTerminate: clear,
    });
  }, [setHold]);

  const pill = (
    <SideSwitch side={side} onChange={w.pick} labels={['Hire', 'Earn']} compact />
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, gap: 10 }}>
        <Segments i={i} progress={w.progress} reduced={reduced} height={3} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <RNText accessibilityRole="header" numberOfLines={1} style={[tx('800', 15, t.colors.ink), { flexShrink: 1 }]}>{WALK_COPY.header}</RNText>
          {pill}
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel={WALK_COPY.close}
            hitSlop={8}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={16} color={t.colors.ink} />
          </Pressable>
        </View>
      </View>
      <View style={{ flex: 1 }} {...pan.panHandlers}>
        <View
          style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 }}
          onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          {area ? (
            <View style={{ borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.line, backgroundColor: '#FFFFFF' }}>
              <Shot shot={cur.shot} width={shotW} label={`TaskDrop screen: ${cur.title}`} reduced={reduced} />
            </View>
          ) : null}
          <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 20, alignItems: 'center', opacity: hint }}>
            <View style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.65)' }}>
              <RNText style={tx('700', 12.5, '#FFFFFF')}>{WALK_COPY.hintSwipe}</RNText>
            </View>
          </Animated.View>
        </View>
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 22,
            gap: 6,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            backgroundColor: t.colors.surface,
            borderTopWidth: 1,
            borderColor: t.colors.line,
          }}
        >
          <RNText style={tx('800', 11.5, t.colors.accent, { letterSpacing: 1, textTransform: 'uppercase' })}>{`Step ${i + 1} of 5`}</RNText>
          <RNText accessibilityRole="header" style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6, lineHeight: 29 })}>{cur.title}</RNText>
          <RNText style={tx('700', 15.5, t.colors.accentDeep, { lineHeight: 21 })}>{cur.purpose}</RNText>
          <RNText style={tx('400', 14, t.colors.muted, { lineHeight: 20, minHeight: 40 })}>{cur.body}</RNText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
            {video ? <VideoButton url={video} label="Video" /> : null}
            <Cta side={side} onFinish={onFinish} grow />
          </View>
          {extra}
        </View>
      </View>
    </View>
  );
}
