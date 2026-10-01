import { View, Text as RNText } from 'react-native';
import { Drop, Ripples } from './Ripples';
import { tx } from './primitives';

/**
 * Desktop web, before sign-in: the brand on the left, the app's own sign-in
 * screen on the right at the width it was designed for. On a phone that
 * screen is the whole screen; here it sits beside a panel that says what
 * TaskDrop is -- the droplet and its ripples, and the three moves of a job.
 */
const PATH: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Say it', body: 'One sentence is enough. We write the post.' },
  { n: '2', title: 'People nearby offer', body: 'Compare prices, ratings and timing.' },
  { n: '3', title: 'Pay when it’s done', body: 'TaskDrop holds the money until you approve.' },
];

export function DesktopAuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#0F1012' }}>
      <View style={{ flex: 1, padding: 56, justifyContent: 'space-between', overflow: 'hidden', backgroundColor: '#0A6F58' }}>
        {/* The droplet and its ripples, large, low in the corner. */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', right: -270, bottom: -270, width: 720, height: 720, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ripples color="rgba(255,255,255,0.55)" size={720} />
          <View style={{ width: 120, height: 120, borderRadius: 120, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <Drop size={64} fill="#FFFFFF" tick="#0A6F58" />
          </View>
        </View>

        <RNText style={tx('800', 30, '#FFFFFF', { letterSpacing: -1 })}>
          taskdrop<RNText style={tx('800', 30, '#7FE3C4')}>.</RNText>
        </RNText>

        <View style={{ maxWidth: 560 }}>
          <RNText style={tx('800', 54, '#FFFFFF', { letterSpacing: -2, lineHeight: 58 })}>
            Drop a task.{'\n'}Watch it ripple{'\n'}to people nearby.
          </RNText>
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 44 }}>
            {PATH.map((p) => (
              <View
                key={p.n}
                style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 16 }}
              >
                <View style={{ width: 28, height: 28, borderRadius: 28, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                  <RNText style={tx('800', 14, '#0A6F58')}>{p.n}</RNText>
                </View>
                <RNText style={tx('800', 16, '#FFFFFF', { marginTop: 12 })}>{p.title}</RNText>
                <RNText style={tx('400', 13, 'rgba(255,255,255,0.78)', { marginTop: 4, lineHeight: 19 })}>{p.body}</RNText>
              </View>
            ))}
          </View>
        </View>

        <RNText style={tx('500', 13, 'rgba(255,255,255,0.6)')}>One account for hiring and earning</RNText>
      </View>

      <View style={{ width: 520, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <View
          style={{
            width: '100%',
            maxWidth: 440,
            height: '100%',
            maxHeight: 860,
            borderRadius: 28,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.08)',
          }}
        >
          {children}
        </View>
      </View>
    </View>
  );
}
