import { useEffect, useState } from 'react';
import { View, Text as RNText } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { askForPush, pushPermission } from '../lib/push';
import { cardSurface } from './ui';
import { Icon } from './Icon';
import { Pressy, tx } from './primitives';

const DISMISSED_KEY = 'taskdrop.alertsCardDismissed';

const WORDS = {
  hire: {
    title: 'Get told when offers arrive',
    body: 'Your task is live. Turn on alerts and we tell you the moment a worker sends an offer.',
  },
  earn: {
    title: 'Get told when you are picked',
    body: 'Turn on alerts and we tell you the moment a customer picks you or answers your question.',
  },
} as const;

/**
 * Asks for phone alerts at the moment they make sense (plan item 5): on My
 * Tasks once something is posted, on My Work once an offer is out. The
 * phone's own question comes only after "Turn on alerts"; sign-in no longer
 * asks (lib/push.ts). Hidden when alerts are on, refused, unavailable, or
 * after "Not now" on this device.
 */
export function AlertsCard({ show, side }: { show: boolean; side: 'hire' | 'earn' }) {
  const t = useTheme();
  const { flash } = useActions();
  const [askable, setAskable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!show) return;
    let alive = true;
    Promise.all([pushPermission(), AsyncStorage.getItem(DISMISSED_KEY).catch(() => null)])
      .then(([p, dismissed]) => alive && setAskable(p === 'ask' && dismissed !== '1'))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [show]);

  if (!show || !askable) return null;

  const turnOn = async () => {
    setBusy(true);
    const on = await askForPush();
    setBusy(false);
    setAskable(false);
    flash(on ? 'Alerts are on' : 'Alerts stay off. You can turn them on in your phone settings');
  };

  const notNow = () => {
    setAskable(false);
    AsyncStorage.setItem(DISMISSED_KEY, '1').catch(() => {});
  };

  const words = WORDS[side];
  return (
    <View style={{ marginHorizontal: 20, marginTop: 14, padding: 16, ...cardSurface(t, 20) }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: side === 'earn' ? t.colors.purpleSoft : t.colors.accentSoft,
          }}
        >
          <Icon name="bell" size={19} color={side === 'earn' ? t.colors.purpleDeep : t.colors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={tx('800', 16, t.colors.ink)}>{words.title}</RNText>
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 4, lineHeight: 20 })}>{words.body}</RNText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Pressy
          onPress={turnOn}
          disabled={busy}
          style={{ flex: 1, height: 46, borderRadius: 999, backgroundColor: t.colors.btn, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : 1 }}
        >
          <RNText style={tx('800', 15, t.colors.onBtn)}>Turn on alerts</RNText>
        </Pressy>
        <Pressy
          onPress={notNow}
          style={{ height: 46, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1.5, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}
        >
          <RNText style={tx('700', 15, t.colors.text)}>Not now</RNText>
        </Pressy>
      </View>
    </View>
  );
}
