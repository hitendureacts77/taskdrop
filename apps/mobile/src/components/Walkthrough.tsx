import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Linking, Modal, PanResponder, Pressable, View, Text as RNText, useWindowDimensions } from 'react-native';
import { Icon } from './Icon';
import { PrimaryButton } from './kit';
import { tx } from './primitives';
import { PersonTheme, useTheme } from '../providers/ThemeProvider';
import { useLayout } from '../lib/layout';
import {
  videoUrl,
  walkAnnouncement,
  walkCard,
  WALK_COPY,
  WALK_LAST,
  WALK_STEPS,
  WALKTHROUGH_VIDEO_LABEL,
  WALKTHROUGH_VIDEO_NOTE,
  type WalkCard,
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
const SHOT_RATIO = 488 / 835;

function openVideo(url: string) {
  Linking.openURL(url).catch(() => {
    /* no browser or YouTube app: nothing else to do */
  });
}

/** Hire (jade) and Earn (royal blue): each pill wears its own person's colour. */
function SideSwitch({ side, onChange }: { side: WalkSide; onChange: (s: WalkSide) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: t.colors.surface2 }}>
      {(['hire', 'earn'] as const).map((k) => (
        <PersonTheme key={k} role={k === 'hire' ? 'poster' : 'worker'}>
          <SidePill on={side === k} label={k === 'hire' ? 'Hire' : 'Earn'} onPress={() => onChange(k)} />
        </PersonTheme>
      ))}
    </View>
  );
}

function SidePill({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label} side`}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 999, backgroundColor: on ? t.colors.btn : 'transparent' }}
    >
      <RNText style={tx('800', 13.5, on ? t.colors.onBtn : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );
}

function Dots({ at }: { at: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 5 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[1, 2, 3, 4, 5].map((n) => (
        <View key={n} style={{ width: n === at ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: n === at ? t.colors.accent : t.colors.line }} />
      ))}
    </View>
  );
}

/**
 * "How TaskDrop works": the first card (the video and "Show me the app"), five
 * real screens with one line each, and the last card. Skip is always at the
 * top. Swipe left and right, or use Next and Back. `extra` sits under every
 * card (the first-run intro puts "Create my account" there, so a returning
 * person can always reach sign-in).
 */
export function Walkthrough({
  side: startSide,
  onSkip,
  onFinish,
  skipLabel = WALK_COPY.skip,
  extra,
}: {
  side: WalkSide;
  onSkip: () => void;
  /** The last card's button: "Post a request" on Hire, "Find work" on Earn. */
  onFinish: (side: WalkSide) => void;
  skipLabel?: string;
  extra?: React.ReactNode;
}) {
  const [side, setSide] = useState<WalkSide>(startSide);
  const [i, setI] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    AccessibilityInfo.announceForAccessibility(walkAnnouncement(side, i));
  }, [side, i]);

  const step = useCallback((d: number) => setI((n) => Math.max(0, Math.min(WALK_LAST, n + d))), []);
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -40) step(1);
          else if (g.dx > 40) step(-1);
        },
      }),
    [step],
  );
  const pick = (s: WalkSide) => {
    setSide(s);
    setI(0);
  };

  return (
    <PersonTheme role={side === 'hire' ? 'poster' : 'worker'}>
      <Inner side={side} i={i} pick={pick} step={step} swipe={swipe.panHandlers} onSkip={onSkip} onFinish={onFinish} skipLabel={skipLabel} extra={extra} />
    </PersonTheme>
  );
}

function Inner({
  side,
  i,
  pick,
  step,
  swipe,
  onSkip,
  onFinish,
  skipLabel,
  extra,
}: {
  side: WalkSide;
  i: number;
  pick: (s: WalkSide) => void;
  step: (d: number) => void;
  swipe: object;
  onSkip: () => void;
  onFinish: (side: WalkSide) => void;
  skipLabel: string;
  extra?: React.ReactNode;
}) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const { desktop: wide } = useLayout();
  const card = walkCard(side, i);
  const video = videoUrl();
  // The screen picture takes what height is left, so a card fits a phone without scrolling.
  // Wide screens show it inside the sign-in page's card, which has less height to spare.
  const shotH = Math.max(260, Math.min(500, height - (width >= 768 ? 520 : 400)));

  let body: React.ReactNode;
  if (card.kind === 'intro') {
    body = (
      <View style={{ borderRadius: 24, backgroundColor: t.colors.btn, padding: 22, gap: 18, minHeight: video && !wide ? Math.min(shotH + 120, 600) : undefined, justifyContent: 'space-between' }}>
        <View style={{ gap: 10 }}>
          <RNText style={tx('800', 26, t.colors.onBtn, { letterSpacing: -0.8 })}>taskdrop.</RNText>
          <RNText style={tx('600', 17, t.colors.onBtn, { lineHeight: 24 })}>{side === 'hire' ? WALK_COPY.introHire : WALK_COPY.introEarn}</RNText>
        </View>
        {video ? (
          <Pressable
            onPress={() => openVideo(video)}
            accessibilityRole="link"
            accessibilityLabel={`${WALKTHROUGH_VIDEO_LABEL}, ${WALKTHROUGH_VIDEO_NOTE}`}
            style={{ aspectRatio: 16 / 10, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="play" size={22} color="#111111" />
            </View>
            <RNText style={tx('600', 12, t.colors.onBtn)}>{WALKTHROUGH_VIDEO_NOTE}</RNText>
          </Pressable>
        ) : null}
        <View style={{ gap: 10 }}>
          {video ? (
            <Pressable
              onPress={() => openVideo(video)}
              accessibilityRole="link"
              accessibilityLabel={WALKTHROUGH_VIDEO_LABEL}
              style={{ minHeight: 52, borderRadius: 999, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }}
            >
              <Icon name="play" size={16} color="#111111" />
              <RNText style={tx('800', 15, '#111111')}>{WALKTHROUGH_VIDEO_LABEL}</RNText>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => step(1)}
            accessibilityRole="button"
            accessibilityLabel={WALK_COPY.showApp}
            style={{ minHeight: 52, borderRadius: 999, borderWidth: 1.5, borderColor: t.colors.onBtn, alignItems: 'center', justifyContent: 'center' }}
          >
            <RNText style={tx('800', 15, t.colors.onBtn)}>{WALK_COPY.showApp}</RNText>
          </Pressable>
        </View>
      </View>
    );
  } else if (card.kind === 'done') {
    body = (
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 40, paddingHorizontal: 8 }}>
        <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={30} color={t.colors.accentDeep} />
        </View>
        <RNText accessibilityRole="header" style={tx('800', 24, t.colors.ink, { letterSpacing: -0.5 })}>{WALK_COPY.doneTitle}</RNText>
        <RNText style={tx('400', 14.5, t.colors.muted, { textAlign: 'center', lineHeight: 21 })}>
          {side === 'hire' ? WALK_COPY.doneHire : WALK_COPY.doneEarn}
        </RNText>
        <PrimaryButton label={side === 'hire' ? WALK_COPY.goHire : WALK_COPY.goEarn} onPress={() => onFinish(side)} style={{ alignSelf: 'stretch', marginTop: 10 }} />
        {video ? (
          <Pressable onPress={() => openVideo(video)} accessibilityRole="link" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 }}>
            <Icon name="play" size={14} color={t.colors.accentDeep} />
            <RNText style={tx('700', 14, t.colors.accentDeep)}>{WALK_COPY.videoAgain}</RNText>
          </Pressable>
        ) : null}
      </View>
    );
  } else {
    body = (
      <View>
        <View
          style={{
            alignSelf: 'center',
            height: shotH,
            width: shotH * SHOT_RATIO,
            maxWidth: '100%',
            borderRadius: 20,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: t.colors.line,
            backgroundColor: t.colors.surface,
          }}
        >
          <Image
            source={SHOTS[card.step.shot]}
            accessibilityLabel={`TaskDrop screen: ${card.step.title}`}
            resizeMode="cover"
            style={{ width: '100%', height: '100%' }}
          />
        </View>
        <RNText style={tx('800', 11.5, t.colors.accent, { letterSpacing: 0.8, marginTop: 14 })}>{`STEP ${card.n} OF 5`}</RNText>
        <RNText accessibilityRole="header" style={tx('800', 20, t.colors.ink, { letterSpacing: -0.3, marginTop: 2 })}>{card.step.title}</RNText>
        <RNText style={tx('400', 14.5, t.colors.muted, { marginTop: 4, lineHeight: 21, minHeight: 42 })}>{card.step.body}</RNText>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <Dots at={card.n} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel={WALK_COPY.back} hitSlop={6} style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
              <RNText style={tx('700', 14, t.colors.muted)}>{WALK_COPY.back}</RNText>
            </Pressable>
            <Pressable
              onPress={() => step(1)}
              accessibilityRole="button"
              accessibilityLabel={card.n === 5 ? WALK_COPY.finish : WALK_COPY.next}
              style={({ pressed }) => ({
                minHeight: 46,
                paddingHorizontal: 22,
                borderRadius: 999,
                backgroundColor: t.colors.btn,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
              })}
            >
              <RNText style={tx('800', 14.5, t.colors.onBtn)}>{card.n === 5 ? WALK_COPY.finish : WALK_COPY.next}</RNText>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // A computer (owner, 27 Nov, design D8): a centred dialog over the page, words at the left, the real screen at the right.
  if (wide) {
    return (
      <DesktopDialog
        side={side}
        card={card}
        pick={pick}
        step={step}
        onSkip={onSkip}
        skipLabel={skipLabel}
        extra={extra}
        body={card.kind === 'step' ? null : body}
      />
    );
  }

  return (
    <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
        <RNText accessibilityRole="header" style={tx('800', 17, t.colors.ink)}>{WALK_COPY.header}</RNText>
        <Pressable onPress={onSkip} accessibilityRole="button" accessibilityLabel={skipLabel} hitSlop={10} style={{ paddingVertical: 8, paddingLeft: 12 }}>
          <RNText style={tx('700', 14, t.colors.muted)}>{skipLabel}</RNText>
        </Pressable>
      </View>
      <SideSwitch side={side} onChange={pick} />
      <View {...swipe}>{body}</View>
      {extra}
    </View>
  );
}

/** An underline tab: the side's own colour (jade for Hire, royal blue for Earn) when chosen. */
function SideTab({ on, label, onPress, u }: { on: boolean; label: string; onPress: () => void; u: (n: number) => number }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label} side`}
      style={{ paddingBottom: u(10), marginBottom: -1, borderBottomWidth: 2, borderBottomColor: on ? t.colors.accentDeep : 'transparent' }}
    >
      <RNText style={tx('600', u(15), on ? t.colors.accentDeep : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );
}

/** A 36 px rectangle button (radius 10) that hugs its words: outlined (Back) or filled (Next). */
function DeskButton({ label, onPress, filled, icon, u }: { label: string; onPress: () => void; filled?: boolean; icon?: 'back' | 'chevronRight'; u: (n: number) => number }) {
  const t = useTheme();
  const fg = filled ? t.colors.onBtn : t.colors.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: u(36),
        paddingHorizontal: 16,
        borderRadius: u(10),
        backgroundColor: filled ? t.colors.btn : t.colors.surface,
        borderWidth: filled ? 0 : 1,
        borderColor: t.colors.line,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon === 'back' ? <Icon name="back" size={u(16)} color={fg} strokeWidth={2.2} /> : null}
      <RNText style={tx('700', u(14), fg)}>{label}</RNText>
      {icon === 'chevronRight' ? <Icon name="chevronRight" size={u(16)} color={fg} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}

/**
 * "How TaskDrop works" on a computer: a dialog about 920 x 540 centred over the page (the page is dimmed behind it),
 * words and the Back / Next buttons on the left, the real screen on a tinted panel on the right. The first and last
 * cards keep their content (`body`) in the same dialog. Sizes are written in screen px and divided by the page zoom.
 */
function DesktopDialog({
  side,
  card,
  pick,
  step,
  onSkip,
  skipLabel,
  extra,
  body,
}: {
  side: WalkSide;
  card: WalkCard;
  pick: (s: WalkSide) => void;
  step: (d: number) => void;
  onSkip: () => void;
  skipLabel: string;
  extra?: React.ReactNode;
  body: React.ReactNode;
}) {
  const t = useTheme();
  const { scale, width: pageW, height: pageH } = useLayout();
  const u = (n: number) => n / scale;
  const w = Math.min(u(920), pageW - u(48));
  const h = Math.min(u(540), pageH - u(48));
  const rightW = Math.min(u(400), w * 0.44);
  const picH = Math.min(u(468), h - u(48));
  const picW = Math.min(picH * SHOT_RATIO, rightW - u(32));
  // The cards without a screen of their own show the nearest real screen beside them.
  const shot = card.kind === 'step' ? card.step.shot : WALK_STEPS[side][card.kind === 'intro' ? 0 : 4].shot;
  const title = card.kind === 'step' ? card.step.title : '';
  const last = card.kind === 'step' && card.n === 5;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onSkip}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18,20,23,0.48)' }}>
        <View
          accessibilityViewIsModal
          accessibilityLabel={WALK_COPY.header}
          // react-native-web passes this role through to the page, so the dialog has a name and a role.
          role="dialog"
          style={{
            width: w,
            height: h,
            flexDirection: 'row',
            borderRadius: u(16),
            overflow: 'hidden',
            backgroundColor: t.colors.surface,
            shadowColor: '#000',
            shadowOpacity: 0.22,
            shadowRadius: 40,
            shadowOffset: { width: 0, height: 24 },
          }}
        >
          <View style={{ flex: 1, minWidth: 0, paddingTop: u(32), paddingBottom: u(32), paddingHorizontal: u(40) }}>
            <Pressable
              onPress={onSkip}
              accessibilityRole="button"
              accessibilityLabel={skipLabel}
              hitSlop={8}
              style={{ position: 'absolute', top: u(20), right: u(20), width: u(32), height: u(32), borderRadius: u(10), alignItems: 'center', justifyContent: 'center', zIndex: 2 }}
            >
              <Icon name="close" size={u(18)} color={t.colors.muted} strokeWidth={2.2} />
            </Pressable>
            <RNText accessibilityRole="header" style={tx('600', u(13), t.colors.muted)}>{WALK_COPY.header}</RNText>
            <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: u(28), marginTop: u(14), borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
              {(['hire', 'earn'] as const).map((k) => (
                <PersonTheme key={k} role={k === 'hire' ? 'poster' : 'worker'}>
                  <SideTab on={side === k} label={k === 'hire' ? 'Hire' : 'Earn'} onPress={() => pick(k)} u={u} />
                </PersonTheme>
              ))}
            </View>

            {card.kind === 'step' ? (
              <>
                <View style={{ flex: 1, justifyContent: 'center' }}>
                  <RNText style={tx('600', u(13), t.colors.accentDeep, { letterSpacing: 0.2 })}>{`Step ${card.n} of 5`}</RNText>
                  <RNText accessibilityRole="header" style={tx('800', u(30), t.colors.ink, { letterSpacing: -0.6, lineHeight: u(38), marginTop: u(10) })}>{title}</RNText>
                  <RNText style={tx('400', u(16), t.colors.muted, { lineHeight: u(25), marginTop: u(12), maxWidth: u(440) })}>{card.step.body}</RNText>
                  {extra ? <View style={{ alignItems: 'flex-start', marginTop: u(8) }}>{extra}</View> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <DeskButton label={WALK_COPY.back} onPress={() => step(-1)} icon="back" u={u} />
                  <Dots at={card.n} />
                  <DeskButton label={last ? WALK_COPY.finish : WALK_COPY.next} onPress={() => step(1)} filled icon="chevronRight" u={u} />
                </View>
              </>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <View style={{ width: '100%', maxWidth: u(440) }}>{body}</View>
                {extra ? <View style={{ alignItems: 'flex-start', marginTop: u(8) }}>{extra}</View> : null}
              </View>
            )}
          </View>
          <View style={{ width: rightW, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <View
              style={{
                width: picW,
                height: picW / SHOT_RATIO,
                borderRadius: u(14),
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: t.colors.line,
                backgroundColor: t.colors.surface,
              }}
            >
              <Image source={SHOTS[shot]} accessibilityLabel={title ? `TaskDrop screen: ${title}` : 'TaskDrop screen'} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
