import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, TextInput, Pressable, Animated, ScrollView } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { submitReview } from '../data/api';
import { fontFamilyFor } from '../theme';
import { tx } from '../components/primitives';

/**
 * Ratings & review — pixel parity with docs/design/_design_markup.html lines
 * 964-994 (avatar, star row with scale-on-select, review word, praise chips,
 * comment box, submit). Data/handlers mirror docs/design/_design_source.jsx
 * lines 812-832 (starRow/reviewWord/praiseChips/submitReview).
 */

const WORDS = ['Poor', 'Fair', 'Good', 'Great', 'Excellent'];
const PRAISE = ['On time', 'Great communication', 'Fair price', 'Went the extra mile', 'Careful work'];

const FALLBACK_TASK = {
  worker: { title: 'Vintage 35mm film camera', price: '₹4,200' },
  poster: { title: 'Assemble a wardrobe', price: '₹1,200' },
} as const;

/** Scale-up feedback on selection, ~ the markup's star transform:scale(1.06). */
function Star({ selected, onPress, color }: { selected: boolean; onPress: () => void; color: string }) {
  const scale = useRef(new Animated.Value(selected ? 1.06 : 1)).current;
  useEffect(() => {
    const anim = Animated.timing(scale, { toValue: selected ? 1.06 : 1, duration: 200, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [selected, scale]);
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Animated.Text style={[tx('400', 33, color), { transform: [{ scale }] }]}>★</Animated.Text>
    </Pressable>
  );
}

function PraiseChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: active ? t.colors.accentSoft : 'transparent',
          borderWidth: 1,
          borderColor: active ? t.colors.accent : t.colors.line,
          borderRadius: 999,
          paddingVertical: 9,
          paddingHorizontal: 15,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}
    >
      <RNText style={tx('600', 13, active ? t.colors.ink : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );
}

/** Ratings & review — 1-5 stars, praise chips, a comment, then submit. */
export function ReviewScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const { mode } = useMode();
  const { openTask, celebrate, flash } = useApp();

  const [stars, setStars] = useState(5);
  const [praise, setPraise] = useState<number[]>([0, 1]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const taskId = typeof params.taskId === 'string' ? params.taskId : null;

  const fallback = FALLBACK_TASK[mode];
  const title = typeof params.title === 'string' ? params.title : (openTask?.title ?? fallback.title);
  const price = openTask?.price ?? fallback.price;

  const reviewWho = mode === 'worker' ? 'the poster' : 'the worker';

  const togglePraise = (i: number) => {
    setPraise((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  };

  const submit = async () => {
    if (busy) return;
    if (!taskId) {
      flash('This is a sample task — open a real one from your requests');
      return;
    }
    setBusy(true);
    try {
      {
        // reviews has no praise column, so the chips ride along in the comment
        // rather than being dropped on the floor.
        const tags = praise.map((i) => PRAISE[i]).filter(Boolean);
        const body = [comment.trim(), tags.length ? tags.join(' · ') : '']
          .filter(Boolean)
          .join('\n');
        await submitReview(taskId, stars, body);
      }
      celebrate('Review posted');
      go('orders');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not post that review');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={back} hitSlop={10}>
          <RNText style={tx('400', 20, t.colors.ink)}>✕</RNText>
        </Pressable>

        <View style={{ alignItems: 'center', marginTop: 22 }}>
          <View
            style={{
              width: 68,
              height: 68,
              borderRadius: 999,
              backgroundColor: t.colors.surface2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('400', 24, t.colors.muted)}>☺</RNText>
          </View>
          <RNText style={tx('800', 23, t.colors.ink, { letterSpacing: -0.69, marginTop: 14, textAlign: 'center' })}>
            How did {reviewWho} do?
          </RNText>
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, textAlign: 'center' })}>
            {title} · {price}
          </RNText>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 22 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star
                key={n}
                selected={n <= stars}
                onPress={() => setStars(n)}
                color={n <= stars ? t.colors.accent : t.colors.line}
              />
            ))}
          </View>
          <RNText style={tx('700', 14, t.colors.accentDeep, { marginTop: 11 })}>
            {WORDS[stars - 1] ?? 'Excellent'}
          </RNText>
        </View>

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 26 })}>
          WHAT WENT WELL
        </RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
          {PRAISE.map((label, i) => (
            <PraiseChip key={label} label={label} active={praise.includes(i)} onPress={() => togglePraise(i)} />
          ))}
        </View>

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>
          WRITE A REVIEW · OPTIONAL
        </RNText>
        <TextInput
          value={comment}
          onChangeText={setComment}
          placeholder="Sourced exactly what I described and delivered a day early…"
          placeholderTextColor={t.colors.muted}
          multiline
          style={{
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
            padding: 14,
            marginTop: 11,
            minHeight: 88,
            textAlignVertical: 'top',
            color: t.colors.ink,
            fontFamily: fontFamilyFor('400'),
            fontSize: 14,
            lineHeight: 20,
          }}
        />
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressable
          onPress={submit}
          style={({ pressed }) => [
            {
              backgroundColor: t.colors.accent,
              borderRadius: 999,
              paddingVertical: 16,
              alignItems: 'center',
              shadowColor: t.colors.accent,
              shadowOpacity: 0.4,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 3,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            },
          ]}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>
            {busy ? 'Posting…' : 'Submit review'}
          </RNText>
        </Pressable>
      </View>
    </Screen>
  );
}
