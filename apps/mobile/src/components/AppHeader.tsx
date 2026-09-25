import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, Modal, ScrollView, Image } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { useApp } from '../providers/AppStateProvider';
import { getProfile, getWallet, type Profile } from '../data/api';
import {
  aiCreditsToday,
  countUnreadNotifications,
  subscribeToNotifications,
  touchPresence,
} from '../data/extras';
import { signedMediaUrl } from '../lib/media';
import { Icon, type IconName } from './Icon';
import { FeedbackSheet } from './FeedbackSheet';
import { Badge, rupees } from './kit';
import { tx } from './primitives';
import { levelFor } from '../lib/levels';

/**
 * The bar across the top of every tab: brand, the Post / Earn switch, and the
 * three things that need reaching from anywhere -- notifications, messages and
 * the account drawer.
 */
export function AppHeader() {
  const t = useTheme();
  const { go, reset, screen } = useNav();
  const { mode, setMode } = useMode();
  const { userId } = useAuth();
  const [unread, setUnread] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [initial, setInitial] = useState('?');
  const [avatar, setAvatar] = useState<string | null>(null);

  // Unread count: read on every screen change, and bumped live.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void countUnreadNotifications().then((n) => alive && setUnread(n));
    return () => {
      alive = false;
    };
  }, [userId, screen]);
  useEffect(() => {
    if (!userId) return;
    return subscribeToNotifications(userId, () => setUnread((n) => n + 1));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void touchPresence(userId);
    getProfile(userId)
      .then(async (p) => {
        if (!alive || !p) return;
        setInitial((p.display_name ?? '?').trim().charAt(0).toUpperCase() || '?');
        if (p.avatar_url) {
          const url = await signedMediaUrl(p.avatar_url);
          if (alive) setAvatar(url);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  const worker = mode === 'worker';

  const iconBtn = (name: IconName, label: string, onPress: () => void, badge?: number) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.colors.surface2 : 'transparent',
      })}
    >
      <Icon name={name} size={21} color={t.colors.ink} strokeWidth={1.8} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 3,
            right: 2,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 999,
            backgroundColor: t.colors.signal,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RNText style={tx('800', 9, '#FFFFFF')}>{badge > 9 ? '9+' : badge}</RNText>
        </View>
      ) : null}
    </Pressable>
  );

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 }}>
        {/* The logo is the way home from anywhere, as on most apps. */}
        <Pressable onPress={() => reset('home')} accessibilityRole="link" accessibilityLabel="TaskDrop home" hitSlop={6}>
          <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.6 })}>
            taskdrop<RNText style={tx('800', 20, t.colors.accent)}>.</RNText>
          </RNText>
        </Pressable>
        <View style={{ flexDirection: 'row', backgroundColor: t.colors.surface2, borderRadius: 999, padding: 3, marginLeft: 4 }}>
          {(['poster', 'worker'] as const).map((m) => {
            const on = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={m === 'poster' ? 'Post mode' : 'Earn mode'}
                style={{
                  paddingVertical: 5,
                  paddingHorizontal: 11,
                  borderRadius: 999,
                  backgroundColor: on ? (m === 'poster' ? t.colors.accent : t.colors.purpleDeep) : 'transparent',
                }}
              >
                <RNText style={tx('700', 12, on ? '#FFFFFF' : t.colors.muted)}>{m === 'poster' ? 'Post' : 'Earn'}</RNText>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        {iconBtn('bell', 'Notifications', () => go('notifications'), unread)}
        {iconBtn('chat', 'Messages', () => go('inbox'))}
        <Pressable
          onPress={() => setDrawer(true)}
          accessibilityRole="button"
          accessibilityLabel="Account menu"
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            marginLeft: 2,
            overflow: 'hidden',
            backgroundColor: worker ? t.colors.purpleDeep : t.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {avatar ? (
            <Image source={{ uri: avatar }} style={{ width: 32, height: 32 }} />
          ) : (
            <RNText style={tx('800', 14, '#FFFFFF')}>{initial}</RNText>
          )}
        </Pressable>
      </View>
      <AccountDrawer visible={drawer} onClose={() => setDrawer(false)} />
    </>
  );
}

/** The account menu that slides in from the right. */
export function AccountDrawer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const { go, reset } = useNav();
  const { mode } = useMode();
  const { userId, signOut } = useAuth();
  const { flash } = useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [ai, setAi] = useState<{ used: number; limit: number } | null>(null);
  const [feedback, setFeedback] = useState(false);

  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      slide.setValue(0);
      return;
    }
    const anim = Animated.timing(slide, { toValue: 1, duration: 240, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [visible, slide]);

  useEffect(() => {
    if (!visible || !userId) return;
    let alive = true;
    void Promise.all([getProfile(userId), getWallet(), aiCreditsToday()])
      .then(([p, w, a]) => {
        if (!alive) return;
        setProfile(p);
        setBalance(w?.balance_minor ?? 0);
        setAi(a);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible, userId]);

  const open = (fn: () => void) => {
    onClose();
    fn();
  };

  const worker = mode === 'worker';
  const level = levelFor(profile?.worker_rating_count ?? 0, Number(profile?.worker_rating_avg ?? 0));

  const row = (icon: IconName, label: string, sub: string, onPress: () => void, right?: React.ReactNode) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingVertical: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={19} color={t.colors.ink} strokeWidth={1.8} />
      <View style={{ flex: 1 }}>
        <RNText style={tx('600', 14, t.colors.ink)}>{label}</RNText>
        <RNText style={tx('400', 11, t.colors.muted, { marginTop: 1 })}>{sub}</RNText>
      </View>
      {right}
    </Pressable>
  );

  return (
    <>
      <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
        <Animated.View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.4)', opacity: slide }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu" />
          <Animated.View
            style={{
              width: '82%',
              maxWidth: 360,
              backgroundColor: t.colors.bg,
              transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [360, 0] }) }],
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 44 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <RNText style={tx('800', 18, t.colors.ink)}>Profile</RNText>
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                  <Icon name="close" size={20} color={t.colors.muted} />
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 999,
                    backgroundColor: worker ? t.colors.purpleDeep : t.colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText style={tx('800', 19, '#FFFFFF')}>
                    {(profile?.display_name ?? '?').trim().charAt(0).toUpperCase()}
                  </RNText>
                </View>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('800', 16, t.colors.ink)} numberOfLines={1}>
                    {profile?.display_name ?? 'Your account'}
                  </RNText>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                    <Badge label={level.name} tone="gold" />
                  </View>
                </View>
              </View>
              {profile?.username ? (
                <RNText style={tx('500', 12, t.colors.muted, { marginTop: 8 })}>@{profile.username}</RNText>
              ) : null}

              <Pressable
                onPress={() => open(() => go('publicProfile', { userId }))}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  marginTop: 14,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  borderRadius: 12,
                  paddingVertical: 11,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="user" size={16} color={t.colors.ink} />
                <RNText style={tx('700', 13, t.colors.ink)}>View profile</RNText>
              </Pressable>

              <View style={{ height: 1, backgroundColor: t.colors.line, marginVertical: 14 }} />

              {row('bookmark', 'Saved tasks', 'Tasks you saved for later', () => open(() => go('saved')))}
              {row('wallet', 'Wallet', balance !== null ? `Balance ${rupees(balance / 100)}` : 'Balance and payments', () =>
                open(() => go('wallet')),
              )}
              {row('card', 'How fees work', 'What TaskDrop takes, and when', () => open(() => go('pricing')))}
              {row('gavel', 'My disputes', 'Track issue resolutions', () => open(() => go('disputes')))}
              {row('settings', 'Settings', 'Account, security and preferences', () => open(() => go('account')))}

              <View style={{ height: 1, backgroundColor: t.colors.line, marginVertical: 10 }} />

              {row('help', 'Help & support', 'Stuck on a payment, task or your account', () => open(() => go('help')))}
              {row('chat', 'Send feedback', 'Report a bug or suggest an improvement', () => {
                onClose();
                setFeedback(true);
              })}

              {ai ? (
                <View style={{ marginTop: 14, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 12, padding: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="sparkle" size={14} color={t.colors.ai} />
                    <RNText style={tx('700', 12, t.colors.ink, { flex: 1 })}>AI credits today</RNText>
                    <RNText style={tx('700', 12, t.colors.ink)}>
                      {Math.max(0, ai.limit - ai.used)}/{ai.limit}
                    </RNText>
                  </View>
                  <View style={{ height: 5, borderRadius: 999, backgroundColor: t.colors.line, marginTop: 8, overflow: 'hidden' }}>
                    <View
                      style={{
                        width: `${Math.max(0, Math.min(100, ((ai.limit - ai.used) / ai.limit) * 100))}%`,
                        height: 5,
                        backgroundColor: t.colors.ai,
                      }}
                    />
                  </View>
                </View>
              ) : null}

              <Pressable
                onPress={() => {
                  onClose();
                  void signOut()
                    .catch(() => flash('Could not sign out'))
                    .finally(() => reset('splash'));
                }}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  marginTop: 18,
                  borderWidth: 1,
                  borderColor: t.colors.signal,
                  borderRadius: 12,
                  paddingVertical: 12,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="logout" size={17} color={t.colors.signal} />
                <RNText style={tx('700', 14, t.colors.signal)}>Sign out</RNText>
              </Pressable>
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
      <FeedbackSheet visible={feedback} onClose={() => setFeedback(false)} />
    </>
  );
}
