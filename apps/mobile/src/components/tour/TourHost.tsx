import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Platform, Pressable, Text as RNText, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TIMING } from '@taskdrop/rules';
import { useAuth } from '../../providers/AuthProvider';
import { useMode } from '../../providers/ModeProvider';
import { useNav } from '../../providers/NavProvider';
import { useTheme } from '../../providers/ThemeProvider';
import { useFees } from '../../lib/useFees';
import { useReducedMotion } from '../../lib/motion';
import { useLayout } from '../../lib/layout';
import { showStagingUi, STAGING_CARD_SEEN_KEY } from '../../lib/environment';
import {
  nextBeat,
  shouldOfferTour,
  TOUR_COPY,
  TOUR_STEPS,
  tourAnnouncement,
  tourBeats,
  tourCta,
  tourPathFor,
  tourText,
  type TourNumbers,
  type TourPath,
} from '../../lib/tour';
import { useAppConfig } from '../AppGate';
import { BottomSheet, PrimaryButton } from '../kit';
import { tx } from '../primitives';
import { TourPractice, type Practice } from './TourPractice';
import { measureTarget, type Rect } from './targets';
import { clearTourOffer, endTour, getTourState, markTourSeen, readTourSeen, startTour, subscribeTour } from './tourStore';

const PAD = 6;

/**
 * The app tour: the offer after onboarding, and the hands-on tour itself.
 * Mounted once next to StagingWelcome. See lib/tour.ts for the steps.
 */
export function TourHost() {
  const { run, pendingIntent } = useSyncExternalStore(subscribeTour, getTourState, getTourState);
  const { environment } = useAppConfig();
  const { userId } = useAuth();
  const { screen } = useNav();
  const [seen, setSeen] = useState<boolean | null>(null);
  const [stagingClear, setStagingClear] = useState(false);

  // Read again on every screen change: the tester card may have just been closed.
  useEffect(() => {
    let live = true;
    void readTourSeen().then((v) => live && setSeen(v));
    if (!showStagingUi(environment)) setStagingClear(true);
    else
      AsyncStorage.getItem(STAGING_CARD_SEEN_KEY)
        .then((v) => live && setStagingClear(v === '1'))
        .catch(() => live && setStagingClear(true));
    return () => {
      live = false;
    };
  }, [screen, environment, pendingIntent]);

  const offer = shouldOfferTour({
    pending: pendingIntent !== null && !run,
    signedIn: Boolean(userId),
    screen,
    seen,
    stagingCardClear: stagingClear,
  });

  const decline = useCallback(() => {
    markTourSeen();
    setSeen(true);
    clearTourOffer();
  }, []);
  const begin = useCallback(() => {
    markTourSeen();
    setSeen(true);
    startTour(tourPathFor(pendingIntent), pendingIntent === 'both');
  }, [pendingIntent]);

  return (
    <>
      <BottomSheet
        visible={offer}
        onClose={decline}
        title={TOUR_COPY.offerTitle}
        footer={
          <View style={{ gap: 6 }}>
            <PrimaryButton label={TOUR_COPY.start} onPress={begin} />
            <PrimaryButton label={TOUR_COPY.later} tone="quiet" onPress={decline} />
          </View>
        }
      >
        <OfferBody />
      </BottomSheet>
      {run ? <TourRunning path={run.path} withEarning={run.withEarning} /> : null}
    </>
  );
}

function OfferBody() {
  const t = useTheme();
  return <RNText style={tx('500', 14, t.colors.text, { lineHeight: 21 })}>{TOUR_COPY.offerBody}</RNText>;
}

/** The tour on screen: a dimmed app with one lit-up control and a coach card. */
function TourRunning({ path: first, withEarning }: { path: TourPath; withEarning: boolean }) {
  const t = useTheme();
  const c = t.colors;
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const reduced = useReducedMotion();
  const { mode, setMode } = useMode();
  const { go, reset } = useNav();
  const fees = useFees();
  const { desktop, tablet } = useLayout();

  const [path, setPath] = useState<TourPath>(first);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [practice, setPractice] = useState<Practice>({});
  const [rect, setRect] = useState<Rect | null>(null);
  // The control could not be found (a layout this build does not know): offer Next so nobody is stuck.
  const [missing, setMissing] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  // The side the person was on, put back when the tour ends.
  const startMode = useRef(mode).current;

  const numbers: TourNumbers = useMemo(
    () => ({ feePct: fees.posterFee, reviewDays: TIMING.REVIEW_WINDOW_DAYS, clearDays: TIMING.CLEARING_PERIOD_DAYS }),
    [fees.posterFee],
  );
  const beats = useMemo(() => tourBeats(path), [path]);
  const beat = beats[Math.min(index, beats.length - 1)];
  const cta = tourCta(beat, desktop || tablet);

  // Start on Home: the drop button and the header live there. Once, not on every render.
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    resetRef.current('home');
    // react-native-web reports a screen reader on every browser, so only the phones' answer is used. On the
    // web the lit-up control is a real button, reachable with Tab and Enter.
    if (Platform.OS !== 'web') void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader).catch(() => {});
  }, []);

  const finish = useCallback(
    (after?: 'hire' | 'earn') => {
      setMode(startMode);
      endTour();
      if (after === 'hire') go('aiPost');
      else if (after === 'earn') go('explore');
    },
    [setMode, startMode, go],
  );
  // Skip, the phone's Back button and Esc all end the tour and leave the app as it was found.
  const skip = useCallback(() => finish(), [finish]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && skip();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skip]);

  const advance = useCallback(() => {
    const n = nextBeat(beats, index);
    if (n < 0) setDone(true);
    else setIndex(n);
  }, [beats, index]);

  const tap = useCallback(() => {
    if (beat.setSide) setMode(beat.setSide);
    if (beat.then) setPractice((p) => ({ ...p, [beat.then as keyof Practice]: true }));
    advance();
  }, [beat, setMode, advance]);

  // Where is the lit-up control? Measured again when the beat, the window or the side changes; the
  // screen behind may still be mounting, so it tries for about a second.
  useEffect(() => {
    if (done || !beat.target) {
      setRect(null);
      return;
    }
    let live = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const find = () => {
      void measureTarget(beat.target as NonNullable<typeof beat.target>).then((r) => {
        if (!live) return;
        if (r) setRect(r);
        else if (tries >= 12) setMissing(true);
        else {
          tries += 1;
          timer = setTimeout(find, 90);
        }
      });
    };
    setRect(null);
    setMissing(false);
    find();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [beat, done, win.width, win.height, mode]);

  useEffect(() => {
    if (!done) AccessibilityInfo.announceForAccessibility(tourAnnouncement(beat));
  }, [beat, done]);

  // The hole glides to the next control (SYS-Motion "push"); with reduced motion it just jumps.
  const ax = useRef(new Animated.Value(0)).current;
  const ay = useRef(new Animated.Value(0)).current;
  const aw = useRef(new Animated.Value(0)).current;
  const ah = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!rect) return;
    const to = { x: rect.x - PAD, y: rect.y - PAD, w: rect.w + PAD * 2, h: rect.h + PAD * 2 };
    if (!placed.current || reduced) {
      placed.current = true;
      ax.setValue(to.x);
      ay.setValue(to.y);
      aw.setValue(to.w);
      ah.setValue(to.h);
      return;
    }
    const glide = (v: Animated.Value, n: number) =>
      Animated.timing(v, { toValue: n, duration: t.motion.push, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: false });
    const anim = Animated.parallel([glide(ax, to.x), glide(ay, to.y), glide(aw, to.w), glide(ah, to.h)]);
    anim.start();
    return () => anim.stop();
  }, [rect, reduced, ax, ay, aw, ah, t.motion.push]);

  // The coach card cross-fades and rises a few points when the words change.
  const swap = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    swap.setValue(reduced ? 0.4 : 0);
    const anim = Animated.timing(swap, { toValue: 1, duration: reduced ? 120 : t.motion.ui, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [beat.id, done, reduced, swap, t.motion.ui]);

  const lit = Boolean(beat.target && rect);
  const cardOnTop = rect ? rect.y + rect.h / 2 > win.height / 2 : false;
  const dim = 'rgba(6,8,10,0.62)';
  const radius = rect ? Math.min(20, (rect.h + PAD * 2) / 2) : 0;

  const seeEarning = () => {
    setMode('worker');
    setPath('earn');
    setIndex(0);
    setDone(false);
    setPractice({});
    placed.current = false;
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={skip}>
      <View style={{ flex: 1 }}>
        <TourPractice view={done ? 'done' : beat.view} practice={practice} path={path} numbers={numbers} />

        {/* Four dim panels round the hole keep the lit-up control crisp. */}
        {lit ? (
          <>
            <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ay, backgroundColor: dim }} />
            <Animated.View style={{ position: 'absolute', top: Animated.add(ay, ah), left: 0, right: 0, bottom: 0, backgroundColor: dim }} />
            <Animated.View style={{ position: 'absolute', top: ay, height: ah, left: 0, width: ax, backgroundColor: dim }} />
            <Animated.View style={{ position: 'absolute', top: ay, height: ah, left: Animated.add(ax, aw), right: 0, backgroundColor: dim }} />
            <Animated.View
              pointerEvents="none"
              style={{ position: 'absolute', left: ax, top: ay, width: aw, height: ah, borderRadius: radius, borderWidth: 2.5, borderColor: c.accent }}
            />
            <Pressable
              onPress={tap}
              accessibilityRole="button"
              accessibilityLabel={cta ?? beat.title}
              style={{ position: 'absolute', left: rect!.x - PAD, top: rect!.y - PAD, width: rect!.w + PAD * 2, height: rect!.h + PAD * 2, borderRadius: radius }}
            />
          </>
        ) : (
          <View pointerEvents="auto" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: done ? dim : 'transparent' }} />
        )}

        {done ? (
          <DoneCard
            path={path}
            withEarning={withEarning && path === 'hire'}
            top={insets.top + 120}
            swap={swap}
            onPrimary={() => finish(path === 'earn' ? 'earn' : 'hire')}
            onClose={() => finish()}
            onSeeEarning={seeEarning}
          />
        ) : (
          <Animated.View
            accessibilityLiveRegion="polite"
            style={[
              {
                position: 'absolute',
                left: 12,
                right: 12,
                alignSelf: 'center',
                maxWidth: 440,
                backgroundColor: c.surface,
                borderRadius: 22,
                borderWidth: t.isDark ? 1 : 0,
                borderColor: c.line,
                padding: 15,
                shadowColor: '#000',
                shadowOpacity: 0.28,
                shadowRadius: 30,
                shadowOffset: { width: 0, height: 14 },
                elevation: 12,
                opacity: swap,
                transform: [{ translateY: swap.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : 5, 0] }) }],
              },
              cardOnTop ? { top: insets.top + 12 } : { bottom: insets.bottom + 24 },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {Array.from({ length: TOUR_STEPS }, (_, i) => (
                  <View
                    key={i}
                    style={{
                      height: 6,
                      width: i + 1 === beat.stop ? 18 : 6,
                      borderRadius: 3,
                      backgroundColor: i + 1 <= beat.stop ? c.accent : c.line,
                    }}
                  />
                ))}
              </View>
              <View style={{ flex: 1 }} />
              <Pressable onPress={skip} accessibilityRole="button" accessibilityLabel="Skip the tour" hitSlop={12} style={{ minHeight: 32, justifyContent: 'center' }}>
                <RNText style={tx('700', 13, c.muted)}>{TOUR_COPY.skip}</RNText>
              </Pressable>
            </View>
            <RNText accessibilityRole="header" style={tx('800', 17, c.ink, { marginTop: 8, letterSpacing: -0.3 })}>
              {beat.title}
            </RNText>
            <RNText style={tx('400', 13.5, c.text, { marginTop: 3, lineHeight: 20 })}>{tourText(beat.body, numbers)}</RNText>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, minHeight: 36 }}>
              {cta ? (
                <View style={{ backgroundColor: c.accentSoft, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999 }}>
                  <RNText style={tx('800', 13, c.accentDeep)}>{cta}</RNText>
                </View>
              ) : (
                <View />
              )}
              {beat.next || ((screenReader || missing) && cta) ? (
                <Pressable
                  onPress={beat.next ? advance : tap}
                  accessibilityRole="button"
                  accessibilityLabel={beat.next ?? 'Next'}
                  style={{ minHeight: 44, minWidth: 44, borderRadius: 999, backgroundColor: c.btn, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' }}
                >
                  <RNText style={tx('800', 13, c.onBtn)}>{beat.next ?? 'Next'}</RNText>
                </Pressable>
              ) : null}
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

function DoneCard({
  path,
  withEarning,
  top,
  swap,
  onPrimary,
  onClose,
  onSeeEarning,
}: {
  path: TourPath;
  withEarning: boolean;
  top: number;
  swap: Animated.Value;
  onPrimary: () => void;
  onClose: () => void;
  onSeeEarning: () => void;
}) {
  const t = useTheme();
  const c = t.colors;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        top,
        left: 18,
        right: 18,
        alignSelf: 'center',
        maxWidth: 400,
        backgroundColor: c.surface,
        borderRadius: 26,
        padding: 22,
        alignItems: 'center',
        borderWidth: t.isDark ? 1 : 0,
        borderColor: c.line,
        elevation: 14,
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 40,
        shadowOffset: { width: 0, height: 20 },
        opacity: swap,
        transform: [{ scale: swap.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
      }}
    >
      <View style={{ width: 64, height: 64, borderRadius: 999, backgroundColor: c.btn, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={tx('800', 30, c.onBtn)}>✓</RNText>
      </View>
      <RNText accessibilityRole="header" style={tx('800', 21, c.ink, { marginTop: 12, letterSpacing: -0.5 })}>
        {TOUR_COPY.doneTitle}
      </RNText>
      <RNText style={tx('400', 13.5, c.text, { marginTop: 6, textAlign: 'center', lineHeight: 20 })}>{TOUR_COPY.doneBody}</RNText>
      <View style={{ width: '100%', marginTop: 16, gap: 6 }}>
        <PrimaryButton label={path === 'earn' ? TOUR_COPY.doneEarn : TOUR_COPY.doneHire} onPress={onPrimary} />
        {withEarning ? <PrimaryButton label={TOUR_COPY.seeEarning} tone="quiet" onPress={onSeeEarning} /> : null}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close the tour" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('700', 14, c.muted)}>Close</RNText>
        </Pressable>
      </View>
    </Animated.View>
  );
}
