import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Badge, Field, TopBar, rupees } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { platformFees, type Fees } from '../data/extras';

/**
 * Pricing & plans.
 *
 * TaskDrop has one plan today, and this page says exactly what it costs -- the
 * live fee settings, not copy -- plus a calculator that turns a month of
 * posting and earning into rupees of fees. Paid plans are announced as coming,
 * without invented prices.
 */
export function PricingScreen() {
  const t = useTheme();
  const { back } = useNav();
  const [fees, setFees] = useState<Fees | null>(null);
  const [spend, setSpend] = useState('5000');
  const [earn, setEarn] = useState('8000');

  useEffect(() => {
    void platformFees().then(setFees);
  }, []);

  const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
  const s = Number(spend) || 0;
  const e = Number(earn) || 0;
  const posterFees = fees ? Math.round(s * fees.posterFee) : 0;
  const workerFees = fees ? Math.round(e * fees.commission) : 0;

  const perks = fees
    ? [
        `${pct(fees.commission)} commission on what you earn`,
        `${pct(fees.posterFee)} service fee on what you spend`,
        `${fees.aiDaily} AI credits a day`,
        'Escrow on every task',
        `Earnings clear in ${fees.clearingDays} days`,
      ]
    : [];

  return (
    <Screen padded={false}>
      <TopBar title="Pricing & plans" onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
        <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>
          One plan covers both posting and earning. You only pay when money moves.
        </RNText>

        <View style={{ marginTop: 16, backgroundColor: t.colors.surface, borderWidth: 1.5, borderColor: t.colors.accent, borderRadius: 16, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <RNText style={tx('800', 18, t.colors.ink, { flex: 1 })}>Free</RNText>
            <Badge label="Your plan" />
          </View>
          <RNText style={tx('800', 28, t.colors.ink, { marginTop: 6 })}>₹0</RNText>
          <View style={{ gap: 9, marginTop: 12 }}>
            {perks.map((p) => (
              <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Icon name="check" size={15} color={t.colors.accent} strokeWidth={2.4} />
                <RNText style={tx('500', 13, t.colors.text)}>{p}</RNText>
              </View>
            ))}
          </View>
        </View>

        <View style={{ marginTop: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 16, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="sparkle" size={16} color={t.colors.purple} />
            <RNText style={tx('800', 15, t.colors.ink, { flex: 1 })}>Plans with lower fees</RNText>
            <Badge label="Coming soon" tone="purple" />
          </View>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6, lineHeight: 18 })}>
            Monthly plans that lower your commission and service fee and add more AI credits are on the way. You’ll be
            able to switch from Settings → Billing.
          </RNText>
        </View>

        <RNText style={tx('800', 17, t.colors.ink, { marginTop: 24 })}>Fee calculator</RNText>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>What a month on TaskDrop costs you today.</RNText>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <Field
            label="Monthly spend"
            value={spend}
            onChangeText={(v) => setSpend(v.replace(/[^0-9]/g, '').slice(0, 8))}
            keyboardType="number-pad"
            left={<RNText style={tx('600', 15, t.colors.muted)}>₹</RNText>}
            style={{ flex: 1 }}
          />
          <Field
            label="Monthly earnings"
            value={earn}
            onChangeText={(v) => setEarn(v.replace(/[^0-9]/g, '').slice(0, 8))}
            keyboardType="number-pad"
            left={<RNText style={tx('600', 15, t.colors.muted)}>₹</RNText>}
            style={{ flex: 1 }}
          />
        </View>
        <View style={{ marginTop: 12, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 15, gap: 8 }}>
          <View style={{ flexDirection: 'row' }}>
            <RNText style={tx('400', 13, t.colors.muted, { flex: 1 })}>Service fees on spending</RNText>
            <RNText style={tx('700', 13, t.colors.ink)}>{rupees(posterFees)}</RNText>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <RNText style={tx('400', 13, t.colors.muted, { flex: 1 })}>Commission on earnings</RNText>
            <RNText style={tx('700', 13, t.colors.ink)}>{rupees(workerFees)}</RNText>
          </View>
          <View style={{ height: 1, backgroundColor: t.colors.line }} />
          <View style={{ flexDirection: 'row' }}>
            <RNText style={tx('700', 14, t.colors.ink, { flex: 1 })}>Estimated monthly fees</RNText>
            <RNText style={tx('800', 16, t.colors.accentDeep)}>{rupees(posterFees + workerFees)}</RNText>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
