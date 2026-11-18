import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useFees } from '../lib/useFees';
import { Icon, type IconName } from './Icon';
import { tx } from './primitives';

/** A made-up round job, only to show where the money goes. */
const EXAMPLE_JOB = 400;
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/**
 * The two small cards under the earning steps in the How sheet: "One job, in
 * money" (the worker commission comes from the live fee settings, so it
 * follows the admin) and "Good to know".
 */
export function HowEarnExtras() {
  const t = useTheme();
  const c = t.colors;
  const { commission } = useFees();
  const fee = Math.round(EXAMPLE_JOB * commission);
  const pct = Math.round(commission * 1000) / 10;

  const line = (label: string, value: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
      <RNText style={tx('400', 13.5, c.ink)}>{label}</RNText>
      <RNText style={tx('600', 13.5, c.ink, { fontVariant: ['tabular-nums'] })}>{value}</RNText>
    </View>
  );
  const tip = (icon: IconName, text: string) => (
    <View key={text} style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
      <Icon name={icon} size={16} color={c.purpleDeep} />
      <RNText style={[tx('400', 12.5, c.ink, { lineHeight: 18 }), { flex: 1 }]}>{text}</RNText>
    </View>
  );

  return (
    <>
      <View style={{ marginTop: 22, padding: 16, borderRadius: 18, backgroundColor: c.purpleSoft }}>
        <RNText style={tx('800', 11, c.purpleDeep, { letterSpacing: 0.8 })}>ONE JOB, IN MONEY</RNText>
        <View style={{ marginTop: 6 }}>
          {line('Your offer', inr(EXAMPLE_JOB))}
          {line(`TaskDrop fee (${pct}%)`, `-${inr(fee)}`)}
        </View>
        <View style={{ height: 1, backgroundColor: c.line, marginVertical: 10 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <RNText style={tx('800', 15, c.purpleDeep)}>You earn</RNText>
          <RNText style={tx('800', 15, c.purpleDeep, { fontVariant: ['tabular-nums'] })}>{inr(EXAMPLE_JOB - fee)}</RNText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <Icon name="lock" size={13} color={c.purpleDeep} />
          <RNText style={tx('400', 12, c.muted)}>Held safely from the moment the customer pays.</RNText>
        </View>
      </View>

      <View style={{ marginTop: 14, padding: 16, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
        <RNText style={tx('800', 11, c.purpleDeep, { letterSpacing: 0.8 })}>GOOD TO KNOW</RNText>
        {tip('chat', 'No chat before the customer accepts your offer.')}
        {tip('eye', "The customer's name and address show only once the work starts.")}
        {tip('lock', 'Never start before the job says Paid. That way the money is always there.')}
        {tip('check', 'After the customer approves, they rate you. Good ratings help you get picked next time.')}
      </View>
    </>
  );
}
