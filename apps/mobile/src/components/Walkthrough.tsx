import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Image, Linking, PanResponder, Pressable, View, Text as RNText, useWindowDimensions } from 'react-native';
import { Icon } from './Icon';
import { PrimaryButton } from './kit';
import { tx } from './primitives';
import { PersonTheme, useTheme } from '../providers/ThemeProvider';
import {
  videoUrl,
  walkAnnouncement,
  walkCard,
  WALK_COPY,
  WALK_LAST,
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
  const card = walkCard(side, i);
  const video = videoUrl();
  // The screen picture takes what height is left, so a card fits a phone without scrolling.
  // Wide screens show it inside the sign-in page's card, which has less height to spare.
  const shotH = Math.max(260, Math.min(500, height - (width >= 768 ? 520 : 400)));

  let body: React.ReactNode;
  if (card.kind === 'intro') {
    body = (
      <View style={{ borderRadius: 24, backgroundColor: t.colors.btn, padding: 22, gap: 18, minHeight: video ? Math.min(shotH + 120, 600) : undefined, justifyContent: 'space-between' }}>
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
