import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, Modal, ScrollView, Image } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import { getProfile, getWallet, type Profile } from '../data/api';
import {
  countUnreadFor,
  subscribeToNotifications,
} from '../data/extras';
import { signedMediaUrl } from '../lib/media';
import { Icon, type IconName } from './Icon';
import { FeedbackSheet } from './FeedbackSheet';
import { PayoutDestinationSheet } from './PayoutDestinationSheet';
import { Badge, ConfirmDialog, IconButton, rupees } from './kit';
import { ModeSwitch } from './ModeSwitch';
import { tx } from './primitives';
import { levelFor } from '../lib/levels';
import { useLayout } from '../lib/layout';

/**
 * The bar across the top of every tab: brand, the Post / Earn switch, and the
 * three things that need reaching from anywhere -- notifications, messages and
 * the account drawer.
 */
/**
 * What the header last showed. Every tab mounts its own header, and starting
 * each one blank made the avatar and the unread badge blink on every switch.
 */
const last = { userId: '' as string | null, initial: '?', avatar: null as string | null, unread: 0 };

export function AppHeader() {
  const t = useTheme();
  const { go, reset, screen } = useNav();
  const { mode } = useMode();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const { userId } = useAuth();
  const same = last.userId === userId;
  const [unread, setUnreadState] = useState(same ? last.unread : 0);
  const [drawer, setDrawer] = useState(false);
  const [initial, setInitialState] = useState(same ? last.initial : '?');
  const [avatar, setAvatarState] = useState<string | null>(same ? last.avatar : null);
  last.userId = userId;
  const setUnread = (next: number | ((n: number) => number)) =>
    setUnreadState((cur) => (last.unread = typeof next === 'function' ? next(cur) : next));
  const setInitial = (v: string) => setInitialState((last.initial = v));
  const setAvatar = (v: string | null) => setAvatarState((last.avatar = v));

  // Unread count: read on every screen change, and bumped live.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void countUnreadFor(mode === 'worker' ? 'worker' : 'poster').then((n) => alive && setUnread(n));
    return () => {
      alive = false;
    };
  }, [userId, screen, mode]);
  useEffect(() => {
    if (!userId) return;
    // A new alert may belong to the other side; recount rather than +1.
    return subscribeToNotifications(userId, () => {
      void countUnreadFor(modeRef.current === 'worker' ? 'worker' : 'poster').then(setUnread);
    });
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
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

  const { desktop, tablet } = useLayout();

  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: desktop || tablet ? 32 : 16,
          paddingTop: desktop || tablet ? 16 : 10,
          paddingBottom: 8,
        }}
      >
        {/* The logo is the way home from anywhere, as on most apps. On wider
            screens the side menu carries the logo and the Hire/Earn switch. */}
        {!desktop && !tablet ? (
          <>
            <Pressable onPress={() => reset('home')} accessibilityRole="link" accessibilityLabel="TaskDrop home" hitSlop={6}>
              <RNText style={tx('800', 21, t.colors.ink, { letterSpacing: -0.6 })}>
                taskdrop<RNText style={tx('800', 21, t.colors.accent)}>.</RNText>
              </RNText>
            </Pressable>
            <View style={{ marginLeft: 4 }}>
              <ModeSwitch />
            </View>
          </>
        ) : null}
        <View style={{ flex: 1 }} />
        <IconButton icon="bell" label="Notifications" onPress={() => go('notifications')} badge={unread} />
        <IconButton icon="chat" label="Messages" onPress={() => go('inbox')} />
        <Pressable
          onPress={() => setDrawer(true)}
          accessibilityRole="button"
          accessibilityLabel="Account menu"
          style={({ pressed }) => ({ marginLeft: 2, transform: [{ scale: pressed ? 0.94 : 1 }] })}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: t.colors.btn,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatar ? (
              <Image source={{ uri: avatar }} style={{ width: 36, height: 36 }} />
            ) : (
              <RNText style={tx('800', 14, t.colors.onBtn)}>{initial}</RNText>
            )}
          </View>
          {/* Presence is automatic: the app is open, so this person is active now. */}
          <View
            style={{
              position: 'absolute',
              right: -1,
              bottom: -1,
              width: 12,
              height: 12,
              borderRadius: 999,
              backgroundColor: t.colors.online,
              borderWidth: 2,
              borderColor: t.colors.bg,
            }}
          />
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
  const { userId, signOut } = useAuth();
  const { flash } = useActions();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [feedback, setFeedback] = useState(false);
  const [accounts, setAccounts] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

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
    void Promise.all([getProfile(userId), getWallet()])
      .then(([p, w]) => {
        if (!alive) return;
        setProfile(p);
        // Credits plus earnings: everything this person can spend on a task.
        setBalance((w?.balance_minor ?? 0) + (w?.credits_minor ?? 0));
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
        <RNText style={tx('700', 15, t.colors.ink)}>{label}</RNText>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 1 })}>{sub}</RNText>
      </View>
      {right}
    </Pressable>
  );

  return (
    <>
      <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
        <Animated.View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'rgba(8,10,12,0.5)', opacity: slide }}>
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
                <IconButton icon="close" label="Close" onPress={onClose} />
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 }}>
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 999,
                    backgroundColor: t.colors.btn,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText style={tx('800', 22, t.colors.onBtn)}>
                    {(profile?.display_name ?? '?').trim().charAt(0).toUpperCase()}
                  </RNText>
                </View>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('800', 18, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
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
                  backgroundColor: t.colors.surface,
                  borderRadius: 16,
                  paddingVertical: 12,
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
              {row('card', 'Bank & UPI accounts', 'Where your earnings are sent', () => {
                onClose();
                setAccounts(true);
              })}
              {row('tag', 'How fees work', 'What TaskDrop takes, and when', () => open(() => go('pricing')))}
              {row('flag', 'My complaints', 'See problems you reported', () => open(() => go('disputes')))}
              {row('settings', 'Settings', 'Account, security and preferences', () => open(() => go('account')))}

              <View style={{ height: 1, backgroundColor: t.colors.line, marginVertical: 10 }} />

              {row('help', 'Help & support', 'Stuck on a payment, task or your account', () => open(() => go('help')))}
              {row('chat', 'Send feedback', 'Report a bug or suggest an improvement', () => {
                onClose();
                setFeedback(true);
              })}


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
                  borderWidth: 1.5,
                  borderColor: t.colors.signal,
                  borderRadius: 999,
                  paddingVertical: 13,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Icon name="back" size={17} color={t.colors.signalDeep} />
                <RNText style={tx('700', 15, t.colors.signalDeep)}>Sign out</RNText>
              </Pressable>
            </ScrollView>
          </Animated.View>
        </Animated.View>
      </Modal>
      <FeedbackSheet visible={feedback} onClose={() => setFeedback(false)} />
      <PayoutDestinationSheet visible={accounts} onClose={() => setAccounts(false)} onChanged={() => {}} />
      <ConfirmDialog
        visible={confirmSignOut}
        danger
        icon="logout"
        title="Sign out of TaskDrop?"
        message="You’ll need your phone number or Google account to sign back in. Your tasks and wallet stay safe."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          onClose();
          void signOut()
            .catch(() => flash('Could not sign out'))
            .finally(() => reset('splash'));
        }}
      />
    </>
  );
}
