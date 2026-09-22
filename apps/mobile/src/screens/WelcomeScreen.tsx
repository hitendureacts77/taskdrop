import React, { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode, type Mode } from '../providers/ModeProvider';
import { tx } from '../components/primitives';

const CARDS: { key: Mode; glyph: string; title: string; sub: string }[] = [
  { key: 'poster', glyph: '✎', title: 'Post a Request', sub: 'I need something done or found' },
  { key: 'worker', glyph: '⌕', title: 'Find Work', sub: 'I want to quote on tasks near me' },
];

function CardIn({
  delay,
  grow = true,
  children,
}: {
  delay: number;
  /** Row cards share the width; a block in a column must not take the height. */
  grow?: boolean;
  children: React.ReactNode;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: 400, delay, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [v, delay]);
  return (
    <Animated.View
      style={{
        ...(grow ? { flex: 1 } : null),
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

export function WelcomeScreen() {
  const t = useTheme();
  const { go } = useNav();
  const { setMode } = useMode();
  const [picked, setPicked] = useState<Mode>('worker');

  const choose = (m: Mode) => {
    setPicked(m);
    setMode(m);
  };

  return (
    <Screen padded={false}>
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingHorizontal: 20, paddingBottom: 26 }}>
        <RNText style={tx('800', 33, t.colors.ink, { letterSpacing: -1.16, lineHeight: 38 })}>
          Real tasks.{'\n'}Real people.{'\n'}Nearby.
        </RNText>

        <RNText
          style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.54, marginTop: 30 })}
        >
          I'M HERE TO
        </RNText>

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 11 }}>
          {CARDS.map((c, i) => {
            const on = picked === c.key;
            return (
              <CardIn key={c.key} delay={i * 80}>
                <Pressable
                  onPress={() => choose(c.key)}
                  style={({ pressed }) => ({
                    backgroundColor: t.colors.surface2,
                    borderWidth: 1,
                    borderColor: on ? t.colors.accent : t.colors.line,
                    borderRadius: 14,
                    paddingVertical: 20,
                    paddingHorizontal: 15,
                    alignItems: 'center',
                    transform: [{ scale: pressed ? 0.985 : 1 }],
                  })}
                >
                  <RNText style={tx('400', 24, t.colors.ink)}>{c.glyph}</RNText>
                  <RNText style={tx('700', 16, t.colors.ink, { marginTop: 12, textAlign: 'center' })}>
                    {c.title}
                  </RNText>
                  <RNText
                    style={tx('400', 12, t.colors.muted, {
                      marginTop: 6,
                      lineHeight: 17.4,
                      textAlign: 'center',
                    })}
                  >
                    {c.sub}
                  </RNText>
                </Pressable>
              </CardIn>
            );
          })}
        </View>

        <CardIn delay={160} grow={false}>
          <Pressable
            onPress={() => go('signup', { mode: 'signup' })}
            style={({ pressed }) => ({
              marginTop: 26,
              backgroundColor: t.colors.accent,
              borderRadius: 999,
              paddingVertical: 16,
              alignItems: 'center',
              shadowColor: t.colors.accent,
              shadowOpacity: 0.35,
              shadowRadius: 22,
              shadowOffset: { width: 0, height: 8 },
              elevation: 6,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <RNText style={tx('700', 16, t.colors.onAccent)}>
              Create account as {picked === 'poster' ? 'Poster' : 'Worker'}
            </RNText>
          </Pressable>

          {/* Signing in used to be a grey line of text, which is not a door a
              returning user can find. Same size and shape as sign-up, one step
              quieter. */}
          <Pressable
            onPress={() => go('signup', { mode: 'signin' })}
            style={({ pressed }) => ({
              marginTop: 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.colors.accent,
              paddingVertical: 15,
              alignItems: 'center',
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <RNText style={tx('700', 16, t.colors.accentDeep)}>Sign in</RNText>
          </Pressable>

          <RNText
            style={tx('400', 12, t.colors.muted, { marginTop: 14, textAlign: 'center' })}
          >
            Already used TaskDrop? Sign in — one account covers both.
          </RNText>
        </CardIn>
      </View>
    </Screen>
  );
}
