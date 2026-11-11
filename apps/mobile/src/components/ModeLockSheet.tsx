import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useMode } from '../providers/ModeProvider';
import { Icon } from './Icon';
import { BottomSheet } from './kit';
import { Pressy, tx } from './primitives';

/**
 * Each mode sees one side of the map (plan D26). Tapping the other side's locked option opens this
 * sheet, which says why and offers the switch. `want` is the side that was tapped.
 */
export function ModeLockSheet({ visible, want, onClose }: { visible: boolean; want: 'jobs' | 'helpers'; onClose: () => void }) {
  const t = useTheme();
  const { setMode } = useMode();
  const toEarn = want === 'jobs';
  const copy = toEarn
    ? {
        title: 'Tasks are in Earn mode',
        body: 'In Hire mode the map shows helpers you can hire. To see tasks people posted near you and send them a quote, switch to Earn mode.',
        go: 'Switch to Earn mode',
        stay: 'Stay in Hire mode',
      }
    : {
        title: 'Helpers are in Hire mode',
        body: 'In Earn mode the map shows tasks you can quote on. To see helpers near you and post a task for them, switch to Hire mode.',
        go: 'Switch to Hire mode',
        stay: 'Stay in Earn mode',
      };
  // Earn wears the blue, Hire the jade (white text only on the deep shades).
  const hue = toEarn ? t.colors.purpleDeep : t.colors.accentDeep;
  const soft = toEarn ? t.colors.purpleSoft : t.colors.accentSoft;
  const doSwitch = () => {
    setMode(toEarn ? 'worker' : 'poster');
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" size={20} color={hue} />
        </View>
        <RNText accessibilityRole="header" style={tx('800', 20, t.colors.ink, { letterSpacing: -0.3 })}>
          {copy.title}
        </RNText>
        <RNText style={tx('500', 14, t.colors.muted, { lineHeight: 21 })}>{copy.body}</RNText>
        <Pressy
          onPress={doSwitch}
          label={copy.go}
          style={{ marginTop: 4, minHeight: 52, borderRadius: 999, backgroundColor: hue, alignItems: 'center', justifyContent: 'center' }}
        >
          <RNText style={tx('700', 15, t.colors.onAccent)}>{copy.go}</RNText>
        </Pressy>
        <Pressy
          onPress={onClose}
          label={copy.stay}
          style={{ minHeight: 52, borderRadius: 999, borderWidth: 1.5, borderColor: t.colors.line, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' }}
        >
          <RNText style={tx('700', 15, t.colors.ink)}>{copy.stay}</RNText>
        </Pressy>
      </View>
    </BottomSheet>
  );
}
