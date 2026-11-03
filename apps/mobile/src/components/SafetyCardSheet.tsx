import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { SAFETY_CARD, SAFETY_CARD_TITLE } from '../legal/disputePolicy';
import { BottomSheet, PrimaryButton } from './kit';
import { tx } from './primitives';

/**
 * The four-line safety card, shown once before a person's first in-person job
 * (lib/safetyCard.ts remembers it). "Got it" carries on with what they were
 * doing; closing the sheet does not, so nothing is posted or sent by accident.
 */
export function SafetyCardSheet({
  visible,
  onDone,
  onClose,
  doneLabel,
}: {
  visible: boolean;
  onDone: () => void;
  onClose: () => void;
  doneLabel: string;
}) {
  const t = useTheme();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={SAFETY_CARD_TITLE}
      subtitle="Shown once, before your first job in person."
      footer={<PrimaryButton label={doneLabel} onPress={onDone} />}
    >
      <View style={{ gap: 12 }}>
        {SAFETY_CARD.map((line, i) => (
          <View key={line} style={{ flexDirection: 'row', gap: 10 }}>
            <RNText style={tx('800', 14, t.colors.accentDeep, { width: 18 })}>{i + 1}</RNText>
            <RNText style={tx('500', 14, t.colors.ink, { flex: 1, lineHeight: 20 })}>{line}</RNText>
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}
