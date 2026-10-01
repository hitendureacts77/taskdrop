import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Image, Pressable } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Badge, EmptyState, Shimmer, TopBar, timeAgo } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { getProfile, listReviewsAbout, type Profile, type Review } from '../data/api';
import { publicProfileStats, verificationState, type PublicStats } from '../data/extras';
import { signedMediaUrl } from '../lib/media';
import { levelFor } from '../lib/levels';
import { presenceOf } from '../lib/presence';
import { roughPlace } from '../lib/place';
import { AvatarPresence } from '../components/PresenceDot';
import { useMode } from '../providers/ModeProvider';

/**
 * Someone's profile as anyone else sees it. Opened on yourself, it is the
 * "preview as others see" view, with a way back to editing.
 */
export function PublicProfileScreen() {
  const t = useTheme();
  const { back, params, go } = useNav();
  const { userId } = useAuth();
  const id = typeof params.userId === 'string' ? params.userId : userId;
  const self = id === userId;
  // Which face of the account to show. Asked for explicitly by the caller;
  // otherwise the other side from yours (a poster looks at workers, a worker
  // at posters), and your own preview shows the side you're on.
  const { mode } = useMode();
  const role: 'worker' | 'poster' =
    params.role === 'worker' || params.role === 'poster'
      ? params.role
      : self
        ? mode
        : mode === 'worker'
          ? 'poster'
          : 'worker';
  const asWorker = role === 'worker';
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [verified, setVerified] = useState<{ phone: boolean; email: boolean } | null>(null);

  useEffect(() => {
    if (!id) return setP(null);
    let alive = true;
    void (async () => {
      const [profile, s, r] = await Promise.all([
        getProfile(id).catch(() => null),
        publicProfileStats(id).catch(() => null),
        listReviewsAbout(id, role).catch(() => [] as Review[]),
      ]);
      if (!alive) return;
      setP(profile);
      setStats(s);
      setReviews(r);
      if (profile?.avatar_url) {
        const url = await signedMediaUrl(profile.avatar_url);
        if (alive) setAvatar(url);
      }
      if (self) setVerified(await verificationState());
    })();
    return () => {
      alive = false;
    };
  }, [id, self, role]);

  if (p === undefined) {
    return (
      <Screen padded={false}>
        <TopBar title="Profile" onBack={back} />
        <View style={{ paddingHorizontal: 20 }}>
          <Shimmer height={180} />
        </View>
      </Screen>
    );
  }
  if (p === null) {
    return (
      <Screen padded={false}>
        <TopBar title="Profile" onBack={back} />
        <EmptyState icon="user" title="This profile is not available" />
      </Screen>
    );
  }

  const level = levelFor(stats?.jobsDone ?? 0, Number(p.worker_rating_avg ?? 0));
  const joined = new Date(p.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const presence = presenceOf(p.last_seen_at);
  const bioText = asWorker ? p.worker_bio : p.bio;
  const rating = asWorker
    ? { avg: Number(p.worker_rating_avg), count: p.worker_rating_count }
    : { avg: Number(p.poster_rating_avg), count: p.poster_rating_count };

  return (
    <Screen padded={false}>
      <TopBar
        title={self ? 'Preview' : p.display_name}
        onBack={back}
        right={
          self ? (
            <Pressable onPress={() => go('profileEdit')} hitSlop={8} accessibilityRole="button">
              <RNText style={tx('700', 13, t.colors.accentDeep)}>Edit profile</RNText>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        {self ? (
          <View style={{ marginHorizontal: 20, flexDirection: 'row', gap: 8, backgroundColor: t.colors.accentSoft, borderRadius: 10, padding: 11, marginBottom: 12 }}>
            <Icon name="eye" size={16} color={t.colors.accentDeep} />
            <RNText style={tx('500', 12, t.colors.accentDeep, { flex: 1 })}>This is how your profile appears to others.</RNText>
          </View>
        ) : null}

        <View
          style={{
            marginHorizontal: 20,
            // Worker profiles in the Earn blue, poster profiles in the Post green.
            backgroundColor: asWorker ? (t.isDark ? '#0C1A4D' : '#1E3A8A') : t.isDark ? '#062B1E' : '#0B3D2C',
            borderRadius: 18,
            padding: 18,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View>
              <View style={{ width: 70, height: 70, borderRadius: 999, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' }}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={{ width: 70, height: 70 }} />
                ) : (
                  <RNText style={tx('800', 26, '#FFFFFF')}>{p.display_name.charAt(0).toUpperCase()}</RNText>
                )}
              </View>
              {/* Status on the picture itself, like a chat app. */}
              <AvatarPresence lastSeen={self ? new Date().toISOString() : p.last_seen_at} ring={asWorker ? '#1E3A8A' : '#0B3D2C'} />
            </View>
            <View style={{ flex: 1 }}>
              <RNText style={tx('800', 19, '#FFFFFF')} numberOfLines={1}>{p.display_name}</RNText>
              {p.username ? <RNText style={tx('500', 13, 'rgba(255,255,255,0.75)', { marginTop: 2 })}>@{p.username}</RNText> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {verified && (verified.phone || verified.email) ? <Badge label="Verified" /> : null}
                {asWorker ? <Badge label={`Lvl ${level.index} · ${level.name}`} tone="gold" /> : null}
              </View>
            </View>
          </View>
          <RNText style={tx('700', 11, 'rgba(255,255,255,0.7)', { marginTop: 12, letterSpacing: 1 })}>
            {asWorker ? 'WORKER PROFILE' : 'CUSTOMER PROFILE'}
          </RNText>
          {bioText ? <RNText style={tx('400', 13, 'rgba(255,255,255,0.88)', { marginTop: 6, lineHeight: 19 })}>{bioText}</RNText> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
            {/* Like a chat app: a green dot while they have TaskDrop open. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: self || presence.online ? '#22C55E' : 'transparent',
                  borderWidth: self || presence.online ? 0 : 1.5,
                  borderColor: 'rgba(255,255,255,0.7)',
                }}
              />
              <RNText style={tx('600', 12, 'rgba(255,255,255,0.88)')}>{self ? 'Active now' : presence.label}</RNText>
            </View>
            <Meta icon="list" text={`Joined ${joined}`} />
            {roughPlace(p.loc_label) ? <Meta icon="pin" text={roughPlace(p.loc_label)!} /> : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', marginHorizontal: 20, marginTop: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, paddingVertical: 14 }}>
          {(asWorker
            ? [
                ['Jobs done', String(stats?.jobsDone ?? '–')],
                ['Rating', rating.count > 0 ? `★ ${rating.avg.toFixed(1)}` : 'New'],
                ['Reviews', String(rating.count)],
              ]
            : [
                ['Tasks posted', String(stats?.tasksPosted ?? '–')],
                ['Rating', rating.count > 0 ? `★ ${rating.avg.toFixed(1)}` : 'New'],
                ['Completed', String(stats?.tasksCompletedAsPoster ?? '–')],
              ]
          ).map(([k, v]) => (
            <View key={k} style={{ flex: 1, alignItems: 'center' }}>
              <RNText style={tx('800', 18, t.colors.ink)}>{v}</RNText>
              <RNText style={tx('500', 11, t.colors.muted, { marginTop: 3 })}>{k}</RNText>
            </View>
          ))}
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          {asWorker && (p.skills ?? []).length > 0 ? (
            <>
              <RNText style={tx('800', 15, t.colors.ink, { marginTop: 20 })}>Works in</RNText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                {p.skills.map((s) => (
                  <View key={s} style={{ backgroundColor: t.colors.accentSoft, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
                    <RNText style={tx('600', 12, t.colors.accentDeep)}>{s}</RNText>
                  </View>
                ))}
              </View>
            </>
          ) : null}
          {(p.languages ?? []).length > 0 ? (
            <>
              <RNText style={tx('800', 15, t.colors.ink, { marginTop: 20 })}>Speaks</RNText>
              <RNText style={tx('400', 13, t.colors.text, { marginTop: 6 })}>{p.languages.join(' · ')}</RNText>
            </>
          ) : null}

          <RNText style={tx('800', 15, t.colors.ink, { marginTop: 20 })}>Reviews</RNText>
          {reviews.length === 0 ? (
            <RNText style={tx('400', 13, t.colors.muted, { marginTop: 8 })}>No reviews yet.</RNText>
          ) : (
            reviews.map((r) => (
              <View key={r.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <RNText style={tx('700', 13, t.colors.ink)}>{r.author?.display_name ?? 'Someone'}</RNText>
                  <RNText style={tx('500', 12, t.colors.accentDeep)}>★ {r.rating.toFixed(1)}</RNText>
                  <RNText style={tx('400', 11, t.colors.muted, { marginLeft: 'auto' })}>{timeAgo(r.created_at)}</RNText>
                </View>
                {r.comment ? <RNText style={tx('400', 13, t.colors.muted, { marginTop: 5, lineHeight: 19 })}>{r.comment}</RNText> : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

function Meta({ icon, text }: { icon: 'clock' | 'list' | 'pin'; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Icon name={icon} size={13} color="rgba(255,255,255,0.75)" />
      <RNText style={tx('500', 12, 'rgba(255,255,255,0.8)')}>{text}</RNText>
    </View>
  );
}
