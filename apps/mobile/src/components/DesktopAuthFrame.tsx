import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { light } from '../theme';
import { HeroBackground } from './Hero';
import { FallingDrop, FloatCard } from './BrandArt';
import { Icon } from './Icon';
import { Drop } from './Ripples';
import { tx } from './primitives';

/**
 * Desktop web, before sign-in (W1): the brand on the left, the app's own
 * sign-in screen on the right in a card at the width it was designed for.
 * The brand half says what TaskDrop is -- the drop falling onto its ripples,
 * what goes out when a task drops, and the three moves of a job.
 */
const PATH: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Say it', body: 'One sentence is enough. We write the post.' },
  { n: '2', title: 'People nearby offer', body: 'Compare prices, ratings and timing.' },
  { n: '3', title: 'Pay when it’s done', body: 'TaskDrop holds the money until you approve.' },
];

export function DesktopAuthFrame({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  // The brand half is always the jade gradient, in both themes.
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 44, paddingVertical: 40, justifyContent: 'space-between', overflow: 'hidden' }}>
        <HeroBackground radius={0} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Drop size={34} fill="#FFFFFF" tick={light.heroMid} />
          <RNText style={tx('800', 26, '#FFFFFF', { letterSpacing: -0.9 })}>
            taskdrop<RNText style={tx('800', 26, '#7FE3C4')}>.</RNText>
          </RNText>
        </View>

        <View style={{ maxWidth: 640 }}>
          <RNText style={tx('800', 54, '#FFFFFF', { letterSpacing: -2.4, lineHeight: 56 })}>
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
                <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                  <RNText style={tx('800', 11, light.heroMid)}>{p.n}</RNText>
                </View>
                <RNText style={tx('800', 16, '#FFFFFF', { marginTop: 12, letterSpacing: -0.3 })}>{p.title}</RNText>
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
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <View
          style={{
            width: '100%',
            maxWidth: 440,
            height: '100%',
            maxHeight: 700,
            borderRadius: 28,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: t.colors.line,
            backgroundColor: t.colors.surface,
            shadowColor: '#000',
            shadowOpacity: t.isDark ? 0 : 0.1,
            shadowRadius: 40,
            shadowOffset: { width: 0, height: 20 },
          }}
        >
          {children}
        </View>
      </View>
    </View>
  );
}
