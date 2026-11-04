import { useEffect } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { FROM_GUEST, needAccount, type AccountReason } from '../lib/guest';
import { Screen } from './ui';
import { EmptyState, TopBar } from './kit';
import type { IconName } from './Icon';
import { tx } from './primitives';

/**
 * Small pieces of guest mode (design D15): someone looking around without an account
 * gets a "Sign in" pill where the bell, messages and avatar would be, and a one-line
 * note on the screens that are about them (My Tasks, Wallet, Profile).
 */

/** The one "Sign in" pill that replaces the bell, messages and avatar. */
export function GuestSignInPill({ full = false }: { full?: boolean }) {
  const t = useTheme();
  const { go } = useNav();
  return (
    <Pressable
      onPress={() => go('welcome', { [FROM_GUEST]: true })}
      accessibilityRole="button"
      accessibilityLabel="Sign in"
      style={({ pressed }) => ({
        alignSelf: full ? 'stretch' : 'auto',
        alignItems: 'center',
        justifyContent: 'center',
        height: 38,
        paddingHorizontal: 18,
        borderRadius: 999,
        backgroundColor: t.colors.accentSoft,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <RNText style={tx('700', 14, t.colors.accentDeep)}>Sign in</RNText>
    </Pressable>
  );
}

/** "You're looking around as a guest." with a Sign in link; nothing is locked. */
export function GuestNote() {
  const t = useTheme();
  const { go } = useNav();
  return (
    <View
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 16,
        backgroundColor: t.colors.accentSoft,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <RNText style={tx('500', 13, t.colors.accentDeep, { flex: 1, lineHeight: 19 })}>
        You’re looking around as a guest. Sign in or make your account to post, offer and get paid.
      </RNText>
      <Pressable
        onPress={() => go('welcome', { [FROM_GUEST]: true })}
        accessibilityRole="link"
        accessibilityLabel="Sign in"
        hitSlop={8}
      >
        <RNText style={tx('800', 13, t.colors.accentDeep, { textDecorationLine: 'underline' })}>Sign in</RNText>
      </Pressable>
    </View>
  );
}

/**
 * A screen that is only about an account (Messages, Notifications, Chat): a guest gets the
 * "Make your account" pop-up and, behind it, a plain page with a Sign in button.
 */
export function GuestScreen({
  title,
  reason,
  icon,
  heading,
  body,
}: {
  title: string;
  reason: AccountReason;
  icon: IconName;
  heading: string;
  body: string;
}) {
  const { back, go } = useNav();
  useEffect(() => {
    needAccount(reason);
  }, [reason]);
  return (
    <Screen padded={false}>
      <TopBar title={title} onBack={back} />
      <EmptyState
        icon={icon}
        title={heading}
        body={body}
        actionLabel="Sign in"
        onAction={() => go('welcome', { [FROM_GUEST]: true })}
        style={{ flex: 1, justifyContent: 'center' }}
      />
    </Screen>
  );
}
