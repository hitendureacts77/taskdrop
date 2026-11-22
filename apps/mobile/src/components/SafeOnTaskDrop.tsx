import { Text as RNText, View } from 'react-native';
import { TIMING } from '@taskdrop/rules';
import { useTheme } from '../providers/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { cardSurface } from './ui';
import { tx } from './primitives';

type Line = { icon: IconName; title: string; body: string };

const DAYS = TIMING.REVIEW_WINDOW_DAYS;

/**
 * Why a job is safer done on TaskDrop than off it, on Home for both sides. Posters already hear "your money
 * is held until you approve"; helpers get the same promise from their side (their pay is held before they
 * start and released when the work is approved), and both are told what they lose by swapping numbers and
 * going offline: no held money, no milestones, no one to help. Plain promises only, no legal claims.
 */
export function SafeOnTaskDrop({ worker }: { worker: boolean }) {
  const t = useTheme();
  const lines: Line[] = worker
    ? [
        {
          icon: 'lock',
          title: 'The money is held before you start',
          body: 'When a poster hires you, they pay first and TaskDrop holds it for the job. No chasing anyone for payment.',
        },
        {
          icon: 'check',
          title: 'Paid when the work is approved',
          body: `Your share is released to you when the poster approves. If they say nothing for ${DAYS} days, the job completes and you are paid.`,
        },
        {
          icon: 'star',
          title: 'Big jobs, paid in milestones',
          body: 'A long job can be split into parts, so you are paid as each part is approved, not only at the end.',
        },
      ]
    : [
        {
          icon: 'lock',
          title: 'Your money is held until you approve',
          body: 'You pay when you pick someone, and TaskDrop holds it. The helper is paid only when you approve the work.',
        },
        {
          icon: 'star',
          title: 'Pay big jobs in milestones',
          body: 'Split a long job into parts and approve each one as it is done.',
        },
        {
          icon: 'check',
          title: 'Something wrong? Report it',
          body: 'Report a problem and the money stays held until it is sorted.',
        },
      ];
  const offline = worker
    ? 'A deal made outside TaskDrop has no held payment, no milestones and no one to help if the poster does not pay. Keep the chat and the payment here.'
    : 'Paying someone outside TaskDrop means no held money, no milestones and no one to help if the work is not done. Keep the chat and the payment here.';

  return (
    <View testID="home-safe-on-taskdrop" style={[cardSurface(t, 20), { marginTop: 32, padding: 18 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            backgroundColor: t.colors.accentSoft,
            borderWidth: 1,
            borderColor: t.colors.accentBorder,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="shield" size={18} color={t.colors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText accessibilityRole="header" style={tx('800', 17, t.colors.ink, { letterSpacing: -0.3 })}>
            {worker ? 'Your pay is protected' : 'Your money is protected'}
          </RNText>
          <RNText style={tx('500', 12.5, t.colors.muted, { marginTop: 2 })}>
            {worker ? 'Why working through TaskDrop is safer' : 'Why hiring through TaskDrop is safer'}
          </RNText>
        </View>
      </View>

      {lines.map((x) => (
        <View key={x.title} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 16 }}>
          <Icon name={x.icon} size={18} color={t.colors.accentDeep} />
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 14, t.colors.ink)}>{x.title}</RNText>
            <RNText style={tx('400', 13, t.colors.muted, { marginTop: 3, lineHeight: 19 })}>{x.body}</RNText>
          </View>
        </View>
      ))}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 10,
          marginTop: 18,
          padding: 12,
          borderRadius: 14,
          backgroundColor: t.colors.signalSoft,
        }}
      >
        <Icon name="shield" size={16} color={t.colors.signalDeep} />
        <RNText style={tx('600', 12.5, t.colors.signalDeep, { flex: 1, lineHeight: 18 })}>
          <RNText style={tx('800', 12.5, t.colors.signalDeep)}>Going offline is risky. </RNText>
          {offline}
        </RNText>
      </View>
    </View>
  );
}
