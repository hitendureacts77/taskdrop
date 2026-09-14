import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { listReviewsAbout, type Review } from '../data/api';

/**
 * Who you are about to deal with.
 *
 * The detail screen had a chevron beside the poster's name that was plain text
 * in a plain View — it pointed at something and opened nothing. This is the
 * something: their record and what other people said about them, which is the
 * information a person actually wants before putting money or labour on the
 * line.
 *
 * Poster and worker reputations are deliberately separate, so this only ever
 * shows the one side being dealt with.
 */

function Stars({ value, color }: { value: number; color: string }) {
  const rounded = Math.round(value);
  return (
    <RNText style={tx('400', 12, color)}>
      {'★'.repeat(Math.max(0, rounded))}
      {'☆'.repeat(Math.max(0, 5 - rounded))}
    </RNText>
  );
}

function whenText(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function PersonSheet({
  visible,
  onClose,
  userId,
  name,
  meta,
  rating,
  ratingCount,
  /** Which reputation to show: how they behave as a poster, or as a worker. */
  role,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string | null;
  name: string;
  meta: string;
  rating: number;
  ratingCount: number;
  role: 'poster' | 'worker';
}) {
  const t = useTheme();
  const [reviews, setReviews] = useState<Review[] | null>(null);

  useEffect(() => {
    if (!visible || !userId) return;
    let alive = true;
    setReviews(null);
    void listReviewsAbout(userId, role)
      .then((rows) => alive && setReviews(rows))
      .catch(() => alive && setReviews([]));
    return () => {
      alive = false;
    };
  }, [visible, userId, role]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 28,
            maxHeight: '86%',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 999,
                backgroundColor: t.colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx('400', 20, t.colors.muted)}>☺</RNText>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <RNText style={tx('800', 19, t.colors.ink, { letterSpacing: -0.35 })}>{name}</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })} numberOfLines={2}>
                {meta}
              </RNText>
            </View>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 9,
              marginTop: 16,
              padding: 13,
              borderRadius: 12,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.line,
            }}
          >
            {ratingCount > 0 ? (
              <>
                <RNText style={tx('800', 17, t.colors.ink)}>{rating.toFixed(1)}</RNText>
                <Stars value={rating} color={t.colors.gold} />
                <RNText style={tx('400', 12, t.colors.muted)}>
                  {ratingCount === 1 ? 'from 1 review' : `from ${ratingCount} reviews`}
                </RNText>
              </>
            ) : (
              // A dash, not 0.0. A new account has no rating; showing a zero
              // reads as a terrible one.
              <RNText style={tx('400', 13, t.colors.muted)}>
                No reviews yet as a {role}. Everyone starts here.
              </RNText>
            )}
          </View>

          <RNText
            style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 20 })}
          >
            WHAT PEOPLE SAID
          </RNText>

          <ScrollView style={{ marginTop: 4 }}>
            {reviews === null ? (
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 16 }}>
                <ActivityIndicator size="small" color={t.colors.muted} />
                <RNText style={tx('400', 13, t.colors.muted)}>Loading reviews…</RNText>
              </View>
            ) : reviews.length === 0 ? (
              <RNText style={tx('400', 13, t.colors.muted, { paddingVertical: 14, lineHeight: 19 })}>
                Nothing written yet. Reviews appear here once a job with them is finished.
              </RNText>
            ) : (
              reviews.map((r) => (
                <View
                  key={r.id}
                  style={{
                    paddingVertical: 13,
                    borderBottomWidth: 1,
                    borderBottomColor: t.colors.line,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Stars value={r.rating} color={t.colors.gold} />
                    <RNText style={tx('400', 12, t.colors.muted, { flex: 1 })} numberOfLines={1}>
                      {r.author?.display_name ?? 'Someone'}
                    </RNText>
                    <RNText style={tx('400', 11, t.colors.muted)}>{whenText(r.created_at)}</RNText>
                  </View>
                  {r.comment ? (
                    <RNText style={tx('400', 13, t.colors.text, { marginTop: 6, lineHeight: 19 })}>
                      {r.comment}
                    </RNText>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>

          <RNText style={tx('400', 11, t.colors.muted, { marginTop: 14, lineHeight: 17 })}>
            Contact details stay hidden until a task starts, for both of you.
          </RNText>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => ({
              marginTop: 14,
              borderRadius: 999,
              paddingVertical: 14,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: t.colors.line,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <RNText style={tx('700', 15, t.colors.ink)}>Close</RNText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
