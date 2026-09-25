import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView } from 'react-native';
import { Screen } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { TopBar } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { platformFees, type Fees } from '../data/extras';

/**
 * How fees work, in plain words and from the live settings. There is one way
 * to use TaskDrop and it costs nothing until money moves; this page says what
 * is taken when it does, for whichever side the person is on.
 */
export function PricingScreen() {
  const t = useTheme();
  const { back } = useNav();
  const { mode } = useMode();
  const [fees, setFees] = useState<Fees | null>(null);

  useEffect(() => {
    void platformFees().then(setFees);
  }, []);

  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const worker = mode === 'worker';

  const rows: { icon: IconName; title: string; body: string; highlight?: boolean }[] = fees
    ? [
        {
          icon: 'briefcase',
          title: `${pct(fees.posterFee)} when you hire`,
          body: 'Added on top of the quote you accept, paid into escrow with it. Nothing is charged for posting.',
          highlight: !worker,
        },
        {
          icon: 'wallet',
          title: `${pct(fees.commission)} when you earn`,
          body: 'Taken from the job’s price when the poster releases payment. Quoting is always free.',
          highlight: worker,
        },
        {
          icon: 'lock',
          title: 'Escrow on every job',
          body: 'The poster’s money is held safely until they approve the work, then released to the worker.',
        },
        {
          icon: 'clock',
          title: `Earnings clear in ${fees.clearingDays} days`,
          body: 'After that they are yours to withdraw to UPI or your bank, with no withdrawal fee.',
        },
        {
          icon: 'sparkle',
          title: `${fees.aiDaily} AI drafts a day, free`,
          body: 'The assistant that writes your posts. When they run out, the quick writer still works.',
        },
      ]
    : [];

  return (
    <Screen padded={false}>
      <TopBar title="How fees work" onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
        <RNText style={tx('400', 14, t.colors.muted, { lineHeight: 21 })}>
          TaskDrop is free to join and free to use. You only pay when money moves.
        </RNText>
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
                <Icon name={r.icon} size={18} color={r.icon === 'sparkle' ? t.colors.ai : t.colors.accentDeep} />
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
