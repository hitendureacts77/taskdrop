import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable } from 'react-native';
import { Screen } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { TopBar } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { platformFees, type Fees } from '../data/extras';
import { FEES, TIMING } from '@taskdrop/rules';

// What the page says until the live settings arrive, or if they cannot (S6-33): the standard fees from the rules.
const STANDARD_FEES: Fees = {
  commission: FEES.WORKER_COMMISSION_PCT,
  posterFee: FEES.POSTER_SERVICE_FEE_PCT,
  clearingDays: TIMING.CLEARING_PERIOD_DAYS,
  cancelFine: FEES.POST_START_CANCEL_PENALTY_PCT,
};

/**
 * How fees work, in plain words and from the live settings. There is one way
 * to use TaskDrop and it costs nothing until money moves; this page says what
 * is taken when it does, for whichever side the person is on.
 */
export function PricingScreen() {
  const t = useTheme();
  const { back } = useNav();
  const { mode } = useMode();
  const [live, setLive] = useState<Fees | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    platformFees().then(
      (f) => alive && setLive(f),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);
  const fees = live ?? STANDARD_FEES;

  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const worker = mode === 'worker';

  const rows: { icon: IconName; title: string; body: string; highlight?: boolean }[] = [
        {
          icon: 'briefcase',
          title: `${pct(fees.posterFee)} when you hire`,
          body: 'Added on top of the offer you accept, and paid together with it. Nothing is charged for posting.',
          highlight: !worker,
        },
        {
          icon: 'wallet',
          title: `${pct(fees.commission)} when you earn`,
          body: 'Taken from the job’s price when the customer releases payment. Making offers is always free.',
          highlight: worker,
        },
        {
          icon: 'lock',
          title: 'Safe payment on every job',
          body: 'The customer’s money is held safely until they approve the work, then released to the worker.',
        },
        {
          icon: 'clock',
          title: `Earnings clear after ${fees.clearingDays} days`,
          body: 'They wait in your wallet while they clear. After that they are yours to withdraw to UPI or your bank, with no withdrawal fee.',
        },
        {
          icon: 'close',
          title: `${pct(fees.cancelFine ?? 0.05)} if you cancel after work starts`,
          body: 'Paid to the worker for the time they already put in; the rest of the job’s price comes back to you. Cancelling before work starts costs nothing.',
        },
      ];

  return (
    <Screen padded={false}>
      <TopBar title="How fees work" onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
        <RNText style={tx('400', 14, t.colors.muted, { lineHeight: 21 })}>
          TaskDrop is free to join and free to use. You only pay when money moves.
        </RNText>
        {failed && !live ? (
          <Pressable onPress={() => setAttempt((n) => n + 1)} accessibilityRole="button" style={{ marginTop: 10, minHeight: 44, justifyContent: 'center' }}>
            <RNText style={tx('600', 13, t.colors.signalDeep, { lineHeight: 19 })}>
              Showing the standard fees; the latest ones could not be loaded. Tap to try again.
            </RNText>
          </Pressable>
        ) : null}
        <View style={{ gap: 10, marginTop: 16 }}>
          {rows.map((r) => (
            <View
              key={r.title}
              style={{
                flexDirection: 'row',
                gap: 12,
                backgroundColor: r.highlight ? t.colors.accentSoft : t.colors.surface,
                borderWidth: 1,
                borderColor: r.highlight ? t.colors.accentBorder : t.colors.line,
                borderRadius: 14,
                padding: 14,
              }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={r.icon} size={18} color={t.colors.accentDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <RNText style={tx('800', 15, t.colors.ink)}>{r.title}</RNText>
                <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4, lineHeight: 19 })}>{r.body}</RNText>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
