import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Text as RNText, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';
import { useTheme } from '../providers/ThemeProvider';
import {
  shouldShowStagingCard,
  STAGING_CARD,
  STAGING_CARD_SEEN_KEY,
  STAGING_REPORT_EMAIL,
} from '../lib/environment';
import { useAppConfig } from './AppGate';
import { BottomSheet, PrimaryButton } from './kit';
import { tx } from './primitives';

/**
 * "How staging works": a card for testers, opened once after sign-in on each
 * device and never in production. Closing it (the button, the backdrop or the
 * phone's Back) remembers that this device has seen it. If the device's storage
 * cannot be read or written the card is simply skipped or shown again; neither
 * breaks anything.
 */
export function StagingWelcome() {
  const { environment } = useAppConfig();
  const { userId } = useAuth();
  const { screen } = useNav();
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(STAGING_CARD_SEEN_KEY)
      .then((v) => live && setSeen(v === '1'))
      .catch(() => live && setSeen(true));
    return () => {
      live = false;
    };
  }, []);

  const close = useCallback(() => {
    setSeen(true);
    AsyncStorage.setItem(STAGING_CARD_SEEN_KEY, '1').catch(() => {});
  }, []);

  const visible = shouldShowStagingCard({ environment, signedIn: Boolean(userId), screen, seen });
  return (
    <BottomSheet visible={visible} onClose={close} title={STAGING_CARD.title} footer={<PrimaryButton label={STAGING_CARD.button} onPress={close} />}>
      <CardBody />
    </BottomSheet>
  );
}

function CardBody() {
  const t = useTheme();
  const c = t.colors;
  const mail = () => void Linking.openURL(`mailto:${STAGING_REPORT_EMAIL}`).catch(() => {});
  return (
    <View>
      <RNText style={tx('500', 14, c.text, { lineHeight: 21 })}>{STAGING_CARD.intro}</RNText>
      <View style={{ marginTop: 12 }}>
        {STAGING_CARD.points.map((p) => (
          <View key={p} style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <RNText style={tx('700', 14, c.signalDeep, { lineHeight: 21 })}>•</RNText>
            <RNText style={tx('600', 14, c.ink, { flex: 1, lineHeight: 21 })}>{p}</RNText>
          </View>
        ))}
      </View>
      <RNText accessibilityRole="header" style={tx('800', 14, c.ink, { marginTop: 18 })}>
        {STAGING_CARD.testHeading}
      </RNText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {STAGING_CARD.test.map((s, i) => (
          <View
            key={s}
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.accentSoft }}
          >
            <RNText style={tx('700', 13, c.accentDeep)}>
              {i + 1}. {s}
            </RNText>
          </View>
        ))}
      </View>
      <RNText accessibilityRole="header" style={tx('800', 14, c.ink, { marginTop: 18 })}>
        {STAGING_CARD.reportHeading}
      </RNText>
      <Pressable onPress={mail} accessibilityRole="link" accessibilityLabel={`Email ${STAGING_REPORT_EMAIL}`}>
        <RNText style={tx('500', 14, c.text, { marginTop: 6, lineHeight: 21 })}>
          {STAGING_CARD.reportBefore}
          <RNText style={tx('700', 14, c.accentDeep, { textDecorationLine: 'underline' })}>{STAGING_REPORT_EMAIL}</RNText>
          {STAGING_CARD.reportAfter}
        </RNText>
      </Pressable>
    </View>
  );
}
