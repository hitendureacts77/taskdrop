import React, { useEffect, useRef } from 'react';
import { View, Text as RNText, Pressable, Animated, ScrollView, type TextStyle } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme, useThemeControls } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { fontFamilyFor } from '../theme';

/**
 * Profile — pixel parity with docs/design/_design_markup.html lines 280-334.
 * Green band header, MODE segmented slider, THEME picker, MY TASKDROP rows and
 * the role-scoped reviews list. Copy/handlers mirror _design_source.jsx lines
 * 372-397 and 907-926. The rating line is role-specific (worker vs poster), which
 * is how the design keeps the two review sets separate rather than merged.
 */

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

function SlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: 340, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [v, delay]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

const WORKER_ROWS: { glyph: string; label: string; go: ScreenName }[] = [
  { glyph: '◈', label: 'Quotes on my service', go: 'myQuotes' },
  { glyph: '✦', label: 'Promote my service', go: 'promote' },
  { glyph: '✓', label: 'Get Verified Pro', go: 'pro' },
  { glyph: '▦', label: 'Earnings and payouts', go: 'withdraw' },
  { glyph: '↪', label: 'Sign out', go: 'splash' },
];

const POSTER_ROWS: { glyph: string; label: string; go: ScreenName }[] = [
  { glyph: '▤', label: 'My requests', go: 'orders' },
  { glyph: '✦', label: 'Promote a request', go: 'promote' },
  { glyph: '✓', label: 'Get Verified Pro', go: 'pro' },
  { glyph: '▦', label: 'Wallet and payments', go: 'wallet' },
  { glyph: '↪', label: 'Sign out', go: 'splash' },
];

const WORKER_REVIEWS = [
  { who: 'Poster 9014', stars: '5.0', when: '3 Sep', text: 'Sourced exactly what I described and delivered a day early.' },
  { who: 'Poster 6620', stars: '4.8', when: '28 Aug', text: 'Clean work, tidy afterwards, fair on the price.' },
];

const POSTER_REVIEWS = [
  { who: 'Tasker 3315', stars: '5.0', when: '4 Sep', text: 'Clear brief, paid into escrow straight away, confirmed fast.' },
  { who: 'Tasker 2098', stars: '4.7', when: '30 Aug', text: 'Reasonable on timings and easy to reach once started.' },
];

export function ProfileScreen() {
  const t = useTheme();
  const { pref, setPref } = useThemeControls();
  const { go, reset } = useNav();
  const { mode, setMode } = useMode();

  const worker = mode === 'worker';
  const band = t.isDark ? '#062B1E' : '#0B3D2C';

  // Mode slider: "Post a Request" left, "Find Work" right.
  const slide = useRef(new Animated.Value(worker ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.timing(slide, {
      toValue: worker ? 1 : 0,
      duration: 320,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [worker, slide]);

  const rows = worker ? WORKER_ROWS : POSTER_ROWS;
  const reviews = worker ? WORKER_REVIEWS : POSTER_REVIEWS;
  const themeNote =
    pref === 'system' ? `Following your device · currently ${t.isDark ? 'dark' : 'light'}` : 'Set by you';

  return (
    <Screen padded={false}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Band header */}
        <View style={{ backgroundColor: band, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 26 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.12)',
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.18)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx('800', 23, '#FFFFFF')}>N</RNText>
            </View>
            <View>
              <RNText style={tx('800', 21, '#FFFFFF', { letterSpacing: -0.42 })}>Narasimha_raju</RNText>
              <RNText style={tx('400', 13, 'rgba(255,255,255,0.78)', { marginTop: 4 })}>
                {worker ? '★ 4.9 worker · 18 jobs done' : '★ 4.8 poster · 31 requests'}
              </RNText>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 }}>
          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>MODE</RNText>
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginTop: 11,
              backgroundColor: t.colors.surface2,
              borderRadius: 12,
              padding: 4,
              position: 'relative',
            }}
          >
            <Animated.View
              style={{
                position: 'absolute',
                top: 4,
                bottom: 4,
                width: '50%',
                left: slide.interpolate({ inputRange: [0, 1], outputRange: ['0%', '50%'] }),
                backgroundColor: t.colors.bg,
                borderRadius: 9,
              }}
            />
            {(['poster', 'worker'] as const).map((m) => {
              const on = mode === m;
              return (
                <Pressable key={m} onPress={() => setMode(m)} style={{ flex: 1, paddingVertical: 11 }}>
                  <RNText
                    style={tx('700', 14, on ? t.colors.ink : t.colors.muted, { textAlign: 'center' })}
                  >
                    {m === 'poster' ? 'Post a Request' : 'Find Work'}
                  </RNText>
                </Pressable>
              );
            })}
          </View>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 9, lineHeight: 18 })}>
            {worker ? 'You browse tasks and send quotes.' : 'You post requests and pick a worker.'}
          </RNText>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginTop: 22,
            }}
          >
            <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>THEME</RNText>
            <RNText style={tx('400', 11, t.colors.muted)}>{themeNote}</RNText>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
            {(['system', 'light', 'dark'] as const).map((p) => {
              const on = pref === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setPref(p)}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 10,
                    paddingVertical: 10,
                    backgroundColor: on ? t.colors.accentSoft : 'transparent',
                    borderWidth: 1,
                    borderColor: on ? t.colors.accent : t.colors.line,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  })}
                >
                  <RNText
                    style={tx('600', 13, on ? t.colors.ink : t.colors.muted, { textAlign: 'center' })}
                  >
                    {p === 'system' ? 'System' : p === 'light' ? 'Light' : 'Dark'}
                  </RNText>
                </Pressable>
              );
            })}
          </View>

          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>
            MY TASKDROP
          </RNText>
          {rows.map((r) => (
            <Pressable
              key={r.label}
              onPress={() => (r.go === 'splash' ? reset('splash') : go(r.go))}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 15,
                paddingVertical: 15,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              })}
            >
              <RNText style={tx('400', 15, t.colors.muted, { width: 22, textAlign: 'center' })}>
                {r.glyph}
              </RNText>
              <RNText
                style={tx('600', 16, r.go === 'splash' ? t.colors.signal : t.colors.ink, { flex: 1 })}
              >
                {r.label}
              </RNText>
              <RNText style={tx('400', 16, t.colors.muted)}>›</RNText>
            </Pressable>
          ))}

          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>
            {worker ? 'WORKER REVIEWS' : 'POSTER REVIEWS'}
          </RNText>
          {reviews.map((r, i) => (
            <SlideIn key={r.who} delay={i * 80}>
              <View
                style={{
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: t.colors.line,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <RNText style={tx('700', 13, t.colors.ink)}>{r.who}</RNText>
                  <RNText style={tx('400', 12, t.colors.accentDeep)}>★ {r.stars}</RNText>
                  <RNText style={tx('400', 11, t.colors.muted, { marginLeft: 'auto' })}>{r.when}</RNText>
                </View>
                <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19.5 })}>
                  {r.text}
                </RNText>
              </View>
            </SlideIn>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
