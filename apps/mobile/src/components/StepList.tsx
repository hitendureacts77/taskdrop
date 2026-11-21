import { Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import { tx } from './primitives';

export type StepState = 'done' | 'current' | 'next';

/**
 * Every step of a flow, listed down the page: a check for the ones done, a ring
 * on the current one, a plain number for the rest. Shown in the desktop aside of
 * a step flow (FormPage) instead of "Step 2 of 5" over a thin bar.
 */
export function StepList({ steps }: { steps: { label: string; state: StepState }[] }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderRadius: t.radius.lg,
        padding: 20,
      }}
    >
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const done = s.state === 'done';
        const current = s.state === 'current';
        return (
          <View
            key={s.label}
            accessible
            accessibilityLabel={`${s.label}${done ? ', done' : current ? ', current step' : ''}`}
            style={{ flexDirection: 'row', alignItems: 'stretch', gap: 12 }}
          >
            <View style={{ alignItems: 'center', width: 28 }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done ? t.colors.btn : current ? t.colors.accentSoft : t.colors.surface,
                  borderWidth: done ? 0 : 1.5,
                  borderColor: current ? t.colors.accent : t.colors.line,
                }}
              >
                {done ? (
                  <Icon name="check" size={15} color={t.colors.onBtn} strokeWidth={2.6} />
                ) : (
                  <Text style={tx('700', 12, current ? t.colors.accentDeep : t.colors.muted)}>{i + 1}</Text>
                )}
              </View>
              {last ? null : <View style={{ width: 2, flex: 1, minHeight: 14, marginVertical: 4, borderRadius: 1, backgroundColor: done ? t.colors.accent : t.colors.line }} />}
            </View>
            <Text
              style={tx(current ? '800' : done ? '600' : '500', 14.5, current ? t.colors.ink : done ? t.colors.ink : t.colors.muted, {
                paddingTop: 4,
                paddingBottom: last ? 0 : 14,
              })}
            >
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
