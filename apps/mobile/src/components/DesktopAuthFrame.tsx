import { useEffect, useState } from 'react';
import { Image, Pressable, View, Text as RNText } from 'react-native';
import { PersonTheme, useTheme } from '../providers/ThemeProvider';
import { useLayout } from '../lib/layout';
import { useReducedMotion } from '../lib/motion';
import { onHero } from '../theme';
import { WALK_COPY, WALK_STEPS, type WalkSide } from '../lib/walkthrough';
import { HeroBackground } from './Hero';
import { Drop } from './Ripples';
import { SHOTS, SHOT_RATIO } from './Walkthrough';
import { tx } from './primitives';

/**
 * Desktop web, before sign-in (owner, 27 Nov: sign-in first, the demo second, and no phone-shaped card).
 *
 * Left, and first to read: the app's own sign-in screen, open on the page at a form's width. Right: a rounded
 * panel that plays "How TaskDrop works" by itself, the same five real screens per side as the walkthrough
 * (lib/walkthrough.ts), with a Hire / Earn switch and one pill per step.
 *
 * The split, the inset rounded showcase panel and its step pills follow 21st.dev "Auth Section 2" (solaceui),
 * ported to React Native with TaskDrop's own tokens.
 */

/** How long each step stays up before the demo moves on by itself. */
const STEP_MS = 4200;
/** The sign-in column: a desktop form's width, not a phone's. */
const FORM_WIDTH = 480;

export function DesktopAuthFrame({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const { height } = useLayout();
  const short = height < 780;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.surface, padding: 12, gap: 12 }}>
      <View style={{ flex: 1.06, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingTop: short ? 12 : 22 }}>
          <Drop size={28} fill={t.colors.heroMid} tick="#FFFFFF" />
          <RNText accessibilityRole="header" style={tx('800', 22, t.colors.ink, { letterSpacing: -0.8 })}>
            taskdrop<RNText style={{ color: t.colors.accent }}>.</RNText>
          </RNText>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: short ? 0 : 12 }}>
          <View style={{ width: '100%', maxWidth: FORM_WIDTH, height: '100%', maxHeight: 720 }}>{children}</View>
        </View>
      </View>
      <DemoPanel height={height} />
    </View>
  );
}

/** "How TaskDrop works", playing by itself beside the sign-in form. */
function DemoPanel({ height }: { height: number }) {
  const [side, setSide] = useState<WalkSide>('hire');
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const reduced = useReducedMotion();
  const steps = WALK_STEPS[side];

  // Moves on by itself; not while the pointer rests on the panel, and not for people who asked for less motion.
  useEffect(() => {
    if (reduced || held) return;
    const id = setInterval(() => setAt((n) => (n + 1) % steps.length), STEP_MS);
    return () => clearInterval(id);
  }, [reduced, held, steps.length]);

  const pick = (s: WalkSide) => {
    setSide(s);
    setAt(0);
  };
  const step = steps[at]!;
  // The screen picture takes the height the panel has left after the words around it.
  const shotH = Math.max(240, Math.min(520, height - 430));

  return (
    <PersonTheme role={side === 'hire' ? 'poster' : 'worker'}>
      <View
        // react-native-web passes these to the element; they do nothing on a phone, which never draws this frame.
        {...({ onMouseEnter: () => setHeld(true), onMouseLeave: () => setHeld(false) } as object)}
        style={{ flex: 0.94, minWidth: 0, borderRadius: 28, overflow: 'hidden' }}
      >
        <HeroBackground radius={28} />
        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 32, paddingTop: 28, paddingBottom: 22 }}>
          <View style={{ flex: 1, width: '100%', maxWidth: 520, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' }}>
              <RNText accessibilityRole="header" style={tx('800', 18, onHero.text, { letterSpacing: -0.3 })}>
                {WALK_COPY.header}
              </RNText>
              <View style={{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: onHero.chip }}>
                {(['hire', 'earn'] as const).map((k) => (
                  <Pressable
                    key={k}
                    onPress={() => pick(k)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: side === k }}
                    accessibilityLabel={`${k === 'hire' ? 'Hire' : 'Earn'} side`}
                    style={{ paddingVertical: 7, paddingHorizontal: 18, borderRadius: 999, backgroundColor: side === k ? '#FFFFFF' : 'transparent' }}
                  >
                    <DemoPillLabel on={side === k} label={k === 'hire' ? 'Hire' : 'Earn'} />
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch', paddingVertical: 16 }}>
              <View
                style={{
                  height: shotH,
                  width: shotH * SHOT_RATIO,
                  borderRadius: 22,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.3)',
                  backgroundColor: '#FFFFFF',
                  shadowColor: '#000',
                  shadowOpacity: 0.28,
                  shadowRadius: 36,
                  shadowOffset: { width: 0, height: 18 },
                }}
              >
                <Image
                  source={SHOTS[step.shot]}
                  accessibilityLabel={`TaskDrop screen: ${step.title}`}
                  resizeMode="cover"
                  style={{ width: '100%', height: '100%' }}
                />
              </View>
            </View>

            <View
              accessibilityLiveRegion="polite"
              style={{
                alignSelf: 'stretch',
                borderRadius: 16,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: 'rgba(255,255,255,0.3)',
                paddingVertical: 14,
                paddingHorizontal: 18,
                minHeight: 96,
              }}
            >
              <RNText style={tx('800', 11.5, 'rgba(255,255,255,0.8)', { letterSpacing: 0.8 })}>{`STEP ${at + 1} OF ${steps.length}`}</RNText>
              <RNText style={tx('800', 19, onHero.text, { letterSpacing: -0.3, marginTop: 2 })}>{step.title}</RNText>
              <RNText style={tx('400', 14, 'rgba(255,255,255,0.86)', { marginTop: 4, lineHeight: 20 })}>{step.body}</RNText>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, paddingTop: 16 }}>
              {steps.map((s, n) => (
                <Pressable
                  key={s.shot}
                  onPress={() => setAt(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show step ${n + 1}: ${s.title}`}
                  hitSlop={10}
                  style={{ height: 5, width: n === at ? 40 : 16, borderRadius: 999, backgroundColor: n === at ? '#FFFFFF' : 'rgba(255,255,255,0.4)' }}
                />
              ))}
            </View>
          </View>
        </View>
      </View>
    </PersonTheme>
  );
}

/** The switch's label: the panel's own colour on the white pill (dark in both themes), white on the panel. */
function DemoPillLabel({ on, label }: { on: boolean; label: string }) {
  const t = useTheme();
  return <RNText style={tx('800', 13.5, on ? t.colors.heroMid : onHero.text)}>{label}</RNText>;
}
