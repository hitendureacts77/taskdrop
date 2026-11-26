import { Pressable, Text as RNText, View } from 'react-native';
import { TIMING } from '@taskdrop/rules';
import { useTheme } from '../providers/ThemeProvider';
import { onHero } from '../theme';
import { Icon, type IconName } from './Icon';
import { BottomSheet } from './kit';
import { tx } from './primitives';

type Line = { icon: IconName; title: string; body: string };

const DAYS = TIMING.REVIEW_WINDOW_DAYS;

/**
 * Why a job is safer done on TaskDrop than off it, for both sides. Posters already hear "your money is held until you
 * approve"; helpers get the same promise from their side (their pay is held before they start and released when the
 * work is approved), and both are told what they lose by swapping numbers and going offline: no held money, no
 * milestones, no one to help. Plain promises only, no legal claims.
 *
 * Task 1.19 F (decision 3): this used to be a full section on both Homes. It is now one line in the Home hero
 * (TrustLine) that opens these same words, unchanged, in a sheet (SafeSheet).
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
    <View testID="home-safe-on-taskdrop">
      {lines.map((x, i) => (
        <View key={x.title} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: i === 0 ? 4 : 16 }}>
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
          marginBottom: 8,
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

/** The same words in a sheet, opened from the hero's trust line. */
export function SafeSheet({ visible, onClose, worker }: { visible: boolean; onClose: () => void; worker: boolean }) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={worker ? 'Your pay is protected' : 'Your money is protected'}
      subtitle={worker ? 'Why working through TaskDrop is safer' : 'Why hiring through TaskDrop is safer'}
    >
      <SafeOnTaskDrop worker={worker} />
    </BottomSheet>
  );
}

/** One line at the foot of the Home hero (on the hero's deep shade, so white words): the promise, and a link to the sheet. */
export function TrustLine({ worker, onPress }: { worker: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID="home-trust-line"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={worker ? 'Your pay is protected. Why working here is safer' : 'Your money is held until you approve. Why hiring here is safer'}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 12,
        backgroundColor: hovered ? onHero.chipHover : onHero.chip,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Icon name="shield" size={16} color={onHero.text} />
      <RNText style={tx('600', 12.5, onHero.text, { flex: 1, lineHeight: 17 })} numberOfLines={2}>
        {worker ? 'Your pay is protected: held before you start' : 'Your money is held until you approve'}
      </RNText>
      <RNText style={tx('800', 12.5, onHero.text)}>{worker ? 'How ›' : 'Why it’s safer ›'}</RNText>
    </Pressable>
  );
}
