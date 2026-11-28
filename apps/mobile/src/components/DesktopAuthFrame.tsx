import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useLayout } from '../lib/layout';
import { useNav } from '../providers/NavProvider';
import { onHero } from '../theme';
import { HeroBackground } from './Hero';
import { Icon } from './Icon';
import { Drop } from './Ripples';
import { tx } from './primitives';
import { LandingArt } from './landing/LandingArt';

/**
 * Desktop web, before sign-in (W1, task 1.21 rows X and W): the brand on the left, the app's own sign-in screen on
 * the right on a plain full-height panel (row W: no floating phone-shaped card). The sign-in screen itself places its
 * 400 px column, the "How TaskDrop works" link and the footer on the panel; the other screens drawn here (the public
 * pages, the age check, picking a username) sit in a 440 px column. The brand half says what TaskDrop is: the headline,
 * the tagline, art that swaps between a ripple map and the real app, the three moves in one slim row and
 * the payment promise. Everything fits the half from 1280x720 up; the art takes whatever height is left.
 */
const STEPS = ['Say it', 'People nearby offer', 'Pay when it’s done'];

/** The design height (px) below which the brand half tightens its spacing. */
const SHORT_HEIGHT = 780;

export function DesktopAuthFrame({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const { screen } = useNav();
  // Design px (the page is zoomed on a desktop): below this the brand half tightens and the other screens lose some margin.
  const short = useLayout().height < SHORT_HEIGHT;
  const pad = short ? 16 : 32;
  const signIn = screen === 'welcome' || screen === 'signup';
  // The brand half is always the jade gradient, in both themes.
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <HeroBackground radius={0} />
        <View style={{ flex: 1, minHeight: 0, paddingHorizontal: 44, paddingTop: short ? 24 : 36, paddingBottom: short ? 18 : 28 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Drop size={34} fill={onHero.text} tick={t.colors.heroMid} />
            <RNText style={tx('800', 26, onHero.text, { letterSpacing: -0.9 })}>
              taskdrop<RNText style={tx('800', 26, onHero.text)}>.</RNText>
            </RNText>
          </View>

          <RNText style={tx('800', short ? 40 : 52, onHero.text, { letterSpacing: short ? -1.8 : -2.4, lineHeight: short ? 42 : 54, marginTop: short ? 16 : 26 })}>
            Drop a task.{'\n'}Watch it ripple{'\n'}to people nearby.
          </RNText>
          <RNText style={tx('500', short ? 16 : 18, 'rgba(255,255,255,0.82)', { marginTop: 10, lineHeight: short ? 22 : 26 })}>
            Ask for anything. Someone gets it done for you.
          </RNText>

          {/* The art swaps between the ripple map and the real app; it takes the height that is left. */}
          <View style={{ flex: 1, minHeight: 0, marginTop: short ? 14 : 22, justifyContent: 'center' }}>
            <View style={{ flex: 1, minHeight: 0, maxHeight: 560 }}>
              <LandingArt />
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: short ? 10 : 16 }}>
            {STEPS.map((label, i) => (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: i < STEPS.length - 1 ? 1 : undefined }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: onHero.text, alignItems: 'center', justifyContent: 'center' }}>
                  <RNText style={tx('800', 12.5, t.colors.heroMid)}>{i + 1}</RNText>
                </View>
                <RNText numberOfLines={1} style={tx('700', 14, onHero.text)}>{label}</RNText>
                {i < STEPS.length - 1 && (
                  <View style={{ flex: 1, minWidth: 12, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' }} />
                )}
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: short ? 10 : 14 }}>
            <Icon name="lock" size={13} color="rgba(255,255,255,0.85)" />
            <RNText style={tx('600', 13, 'rgba(255,255,255,0.85)')}>Payment held safely until you approve</RNText>
          </View>
        </View>
      </View>

      {/* The same box as before the redesign (flex 1 with 32 px of side padding), so the green half keeps its width. */}
      <View style={{ flex: 1, paddingHorizontal: 32, backgroundColor: t.colors.surface }}>
        {signIn ? (
          <View style={{ flex: 1, marginHorizontal: -32 }}>{children}</View>
        ) : (
          <View style={{ flex: 1, width: '100%', maxWidth: 440, alignSelf: 'center', paddingVertical: pad }}>{children}</View>
        )}
      </View>
    </View>
  );
}
