import React, { useEffect, useRef } from 'react';
import { View, Text as RNText, Pressable, Animated, ScrollView } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { tx } from '../components/primitives';

function CardIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: 360, delay, useNativeDriver: true });
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

export function CreateScreen() {
  const t = useTheme();
  const { go, back } = useNav();
  const { mode } = useMode();
  const worker = mode === 'worker';

  const pillars = [
    {
      glyph: '⚒',
      title: 'Services',
      sub: worker ? 'Hands-on work you can do for others' : 'Repairs, moving, errands, anything hands-on',
      stat: '412 open · avg ₹1,450',
    },
    {
      glyph: '◈',
      title: 'Products',
      sub: worker ? 'Goods you can source or hunt down' : 'Goods to source, hunt down or buy for you',
      stat: '86 open · avg ₹5,200',
    },
    {
      glyph: '◉',
      title: 'Local Intel',
      sub: worker ? 'On-the-ground checks near you' : 'Answers only a local would know',
      stat: '54 open · avg ₹600',
    },
  ];

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={back} hitSlop={10}>
          <RNText style={tx('400', 20, t.colors.ink)}>✕</RNText>
        </Pressable>

        <RNText style={tx('800', 27, t.colors.ink, { letterSpacing: -0.81, marginTop: 20 })}>
          {worker ? 'What do you offer?' : 'What do you need?'}
        </RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
          {worker
            ? 'Pick a category. Customers find your service through it.'
            : 'Pick a category. It decides who sees your request first.'}
        </RNText>

        <View style={{ marginTop: 24 }}>
          {pillars.map((p, i) => (
            <CardIn key={p.title} delay={i * 70}>
              <Pressable
                onPress={() => go('postDetails', { pillar: i })}
                style={({ pressed }) => ({
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  borderRadius: 16,
                  padding: 18,
                  marginBottom: 12,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: t.colors.accentSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <RNText style={tx('400', 19, t.colors.accentDeep)}>{p.glyph}</RNText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <RNText style={tx('700', 17, t.colors.ink)}>{p.title}</RNText>
                    <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4, lineHeight: 18.2 })}>
                      {p.sub}
                    </RNText>
                  </View>
                  <RNText style={tx('400', 16, t.colors.muted)}>›</RNText>
                </View>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 13 })}>{p.stat}</RNText>
              </Pressable>
            </CardIn>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
