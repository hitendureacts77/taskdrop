import { useState } from 'react';
import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTheme } from '../../providers/ThemeProvider';
import { useMode } from '../../providers/ModeProvider';
import { useNav } from '../../providers/NavProvider';
import { fontFamilyFor } from '../../theme';
import { useKeyboardOpen } from '../../lib/useKeyboardOpen';
import { useWaitingCount } from '../../lib/useWaiting';
import { TAB_ROUTE } from '../../navigation/nativeTabs';
import { takeStart } from '../../navigation/nativeStart';

/**
 * The five bottom tabs, as the system's own tab bar (iOS and Android; the web
 * has its own, in ScreenHost). The bar steps aside while the keyboard is up,
 * as the old bar did. Opening a screen covers the whole tab view, bar and all,
 * because the stack above holds it.
 */
export default function TabsLayout() {
  // First time here after the app starts: signed out goes to the splash, an
  // unfinished sign-in to worker setup.
  const [start] = useState(takeStart);
  if (start) return <Redirect href={{ pathname: '/screen/[name]', params: { name: start } }} />;
  return <Tabs />;
}

function Tabs() {
  const t = useTheme();
  const { screen } = useNav();
  const { mode } = useMode();
  const keyboardOpen = useKeyboardOpen();
  const waiting = useWaitingCount(screen);
  const worker = mode === 'worker';
  const c = t.colors;

  const page = { backgroundColor: c.bg };
  const waitingLabel = waiting > 9 ? '9+' : String(waiting);

  return (
    <NativeTabs
      hidden={keyboardOpen}
      // The stack above handles Android's back button.
      backBehavior="none"
      labelVisibilityMode="labeled"
      tintColor={c.accentDeep}
      iconColor={{ default: c.muted, selected: c.accentDeep }}
      labelStyle={{
        default: { color: c.muted, fontFamily: fontFamilyFor('600'), fontSize: 11 },
        selected: { color: c.accentDeep, fontFamily: fontFamilyFor('700'), fontSize: 11 },
      }}
      backgroundColor={c.surface}
      indicatorColor={c.accentSoft}
      badgeBackgroundColor={c.signalDeep}
      badgeTextColor={c.onAccent}
    >
      <NativeTabs.Trigger name={TAB_ROUTE.home.name} contentStyle={page} disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md={{ default: 'home', selected: 'home_filled' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name={TAB_ROUTE.explore.name} contentStyle={page} disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>{worker ? 'Find work' : 'Explore'}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'safari', selected: 'safari.fill' }} md="explore" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name={TAB_ROUTE.myTasks.name}
        contentStyle={page}
        disableAutomaticContentInsets
        accessibilityLabel={`${worker ? 'My Work' : 'My Tasks'}${waiting > 0 ? `, ${waiting} needing attention` : ''}`}
      >
        <NativeTabs.Trigger.Label>{worker ? 'My Work' : 'My Tasks'}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'list.bullet.clipboard', selected: 'list.bullet.clipboard.fill' }} md="assignment" />
        {waiting > 0 ? <NativeTabs.Trigger.Badge>{waitingLabel}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name={TAB_ROUTE.wallet.name} contentStyle={page} disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Wallet</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'creditcard', selected: 'creditcard.fill' }} md="account_balance_wallet" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name={TAB_ROUTE.profile.name} contentStyle={page} disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
