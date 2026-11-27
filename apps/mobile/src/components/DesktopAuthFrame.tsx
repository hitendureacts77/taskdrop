import { ScrollView, View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useLayout } from '../lib/layout';
import { useNav } from '../providers/NavProvider';
import { onHero } from '../theme';
import { HeroBackground } from './Hero';
import { FallingDrop, FloatCard } from './BrandArt';
import { Icon } from './Icon';
import { Drop } from './Ripples';
import { tx } from './primitives';

/**
 * Desktop web, before sign-in (W1): the brand on the left, the app's own
 * sign-in screen on the right on a plain full-height panel (27 Nov design D1: no floating phone-shaped card).
 * The sign-in screen itself places its 400 px column, the "How TaskDrop works" link and the footer on the panel;
 * the other screens drawn here (the public pages, the age check, picking a username) sit in a 440 px column.
 * The brand half says what TaskDrop is -- the drop falling onto its ripples,
 * what goes out when a task drops, and the three moves of a job.
 */
const PATH: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Say it', body: 'One sentence is enough. We write the post.' },
  { n: '2', title: 'People nearby offer', body: 'Compare prices, ratings and timing.' },
  { n: '3', title: 'Pay when it’s done', body: 'TaskDrop holds the money until you approve.' },
];

/** The design height (px) the brand half needs at its full spacing. */
const SHORT_HEIGHT = 780;

export function DesktopAuthFrame({ children, screen: shownScreen }: { children: React.ReactNode; screen?: string }) {
  const t = useTheme();
  const { screen: navScreen } = useNav();
  // The screen drawn in the panel. While "How TaskDrop works" is open over the sign-in page, that page is still the one drawn.
  const screen = shownScreen ?? navScreen;
  // Design px (the page is zoomed on a desktop): below this the brand half no longer fits, so it
  // scrolls inside its gradient and the other screens lose some of their margin.
  const short = useLayout().height < SHORT_HEIGHT;
  const pad = short ? 16 : 32;
  const signIn = screen === 'welcome' || screen === 'signup';
  // The brand half is always the jade gradient, in both themes.
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <HeroBackground radius={0} />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 44, paddingVertical: short ? 28 : 40, justifyContent: 'space-between' }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Drop size={34} fill={onHero.text} tick={t.colors.heroMid} />
            <RNText style={tx('800', 26, onHero.text, { letterSpacing: -0.9 })}>
              taskdrop<RNText style={tx('800', 26, onHero.text)}>.</RNText>
            </RNText>
          </View>

          <View style={{ maxWidth: 640 }}>
            <RNText style={tx('800', 54, onHero.text, { letterSpacing: -2.4, lineHeight: 56 })}>
              Drop a task.{'\n'}Watch it ripple{'\n'}to people nearby.
            </RNText>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 28 }}>
              {PATH.map((p) => (
                <View
                  key={p.n}
                  style={{
                    flex: 1,
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.16)',
                    borderRadius: 18,
                    padding: 16,
                  }}
                >
                  <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: onHero.text, alignItems: 'center', justifyContent: 'center' }}>
                    <RNText style={tx('800', 11, t.colors.heroMid)}>{p.n}</RNText>
                  </View>
                  <RNText style={tx('800', 16, onHero.text, { marginTop: 12, letterSpacing: -0.3 })}>{p.title}</RNText>
                  <RNText style={tx('400', 13, 'rgba(255,255,255,0.8)', { marginTop: 4, lineHeight: 20 })}>{p.body}</RNText>
                </View>
              ))}
            </View>
          </View>

          {/* The drop falling onto its ripples, with what goes out around it. */}
          <View style={{ height: 300, maxWidth: 640, alignItems: 'center', justifyContent: 'flex-end' }}>
            <FallingDrop />
            <FloatCard icon="wrench" title="Plumber · 1.2 km" sub="3 offers in 9 min" style={{ left: 0, top: 40 }} />
            <FloatCard icon="globe" tone="ai" title="Logo design · Remote" sub="from ₹1,500" delay={1100} style={{ right: 0, top: 96 }} />
            <View
              style={{
                position: 'absolute',
                left: 50,
                bottom: 30,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderRadius: 999,
                paddingVertical: 8,
                paddingHorizontal: 14,
                backgroundColor: 'rgba(255,255,255,0.12)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.3)',
              }}
            >
              <Icon name="lock" size={13} color="#FFFFFF" />
              <RNText style={tx('700', 13, '#FFFFFF')}>Payment held safely until you approve</RNText>
            </View>
          </View>

          <RNText style={tx('500', 14, 'rgba(255,255,255,0.78)')}>One account for hiring and earning</RNText>
        </ScrollView>
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
