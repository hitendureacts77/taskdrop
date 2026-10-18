import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Linking, Platform, Pressable, Text as RNText, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAppConfig, refreshAppConfig, startAppConfig, subscribeAppConfig, type AppConfig } from '../lib/appConfig';
import { useTheme } from '../providers/ThemeProvider';
import { PrimaryButton } from './kit';
import { tx } from './primitives';

/** What the admin panel has switched for this app, live. */
export function useAppConfig(): AppConfig {
  return useSyncExternalStore(subscribeAppConfig, getAppConfig, getAppConfig);
}

/**
 * Between the providers and the app. Reads app-config and, when the admin
 * panel says so, replaces the app with a maintenance page or an "update the
 * app" page, or adds an announcement banner above it. Everything else passes
 * straight through. The app keeps the same place in the tree whether or not a
 * banner is showing, so a banner appearing never resets what someone is doing.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const cfg = useAppConfig();
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => startAppConfig(), []);

  if (cfg.maintenance.on) return <Maintenance message={cfg.maintenance.message} />;
  if (cfg.update.required) return <UpdateNeeded url={cfg.update.url} />;

  const banner = cfg.banner && !(dismissed === cfg.banner.text && cfg.banner.level !== 'critical') ? cfg.banner : null;
  return (
    <View style={{ flex: 1 }}>
      {banner ? <Banner banner={banner} onDismiss={() => setDismissed(banner.text)} /> : null}
      {/* The banner has used the top of the screen; the app below must not leave the same gap again. */}
      <SafeAreaInsetsContext.Consumer>
        {(i) => (
          <SafeAreaInsetsContext.Provider
            value={banner && i ? { ...i, top: 0 } : i}
          >
            <View style={{ flex: 1 }}>{children}</View>
          </SafeAreaInsetsContext.Provider>
        )}
      </SafeAreaInsetsContext.Consumer>
    </View>
  );
}

function Page({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="alert"
      style={{
        flex: 1,
        backgroundColor: t.colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <View style={{ width: '100%', maxWidth: 420, alignItems: 'center' }}>
        <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.4 })}>
          taskdrop<RNText style={{ color: t.colors.accent }}>.</RNText>
        </RNText>
        <RNText style={tx('800', 26, t.colors.ink, { marginTop: 28, textAlign: 'center', letterSpacing: -0.5 })}>{title}</RNText>
        <RNText style={tx('500', 15, t.colors.muted, { marginTop: 10, textAlign: 'center', lineHeight: 22 })}>{body}</RNText>
        <View style={{ marginTop: 28, width: '100%' }}>{children}</View>
      </View>
    </View>
  );
}

function Maintenance({ message }: { message: string | null }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    await refreshAppConfig(true);
    setBusy(false);
  };
  return (
    <Page title="We’ll be right back" body={message ?? 'TaskDrop is being updated. Please try again in a little while.'}>
      <PrimaryButton label="Try again" onPress={() => void retry()} busy={busy} />
    </Page>
  );
}

function UpdateNeeded({ url }: { url: string | null }) {
  const web = Platform.OS === 'web';
  const go = () => {
    if (web && !url && typeof window !== 'undefined') window.location.reload();
    else if (url) void Linking.openURL(url).catch(() => {});
  };
  return (
    <Page
      title="Time to update"
      body={web ? 'A newer version of TaskDrop is ready. Reload to get it.' : 'Please update TaskDrop to keep using it. Your tasks and money are safe.'}
    >
      {web || url ? <PrimaryButton label={web ? 'Reload' : 'Update the app'} onPress={go} /> : null}
    </Page>
  );
}

const BANNER = {
  info: { bg: 'accentSoft', ink: 'accentDeep' },
  warning: { bg: 'goldSoft', ink: 'goldInk' },
  critical: { bg: 'signalSoft', ink: 'signalDeep' },
} as const;

function Banner({ banner, onDismiss }: { banner: NonNullable<AppConfig['banner']>; onDismiss: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const tone = BANNER[banner.level];
  const open = banner.link ? () => void Linking.openURL(banner.link!).catch(() => {}) : undefined;
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: t.colors[tone.bg],
        paddingTop: insets.top + 8,
        paddingBottom: 8,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Pressable onPress={open} disabled={!open} accessibilityRole={open ? 'link' : 'text'} style={{ flex: 1 }}>
        <RNText style={tx('600', 13, t.colors[tone.ink], { lineHeight: 18 })}>
          {banner.text}
          {open ? ' ›' : ''}
        </RNText>
      </Pressable>
      {banner.level === 'critical' ? null : (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <RNText style={tx('700', 16, t.colors[tone.ink])}>×</RNText>
        </Pressable>
      )}
    </View>
  );
}
