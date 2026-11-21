import { View, Text as RNText, Pressable } from 'react-native';
import { Icon, type IconName } from './Icon';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import type { EarnGoal } from '../data/extras';

/** The three answers to "why do you want to earn on TaskDrop?" (migration 179), in the order shown. */
export const EARN_GOALS: readonly { key: EarnGoal; icon: IconName; title: string; sub: string }[] = [
  { key: 'business', icon: 'trending', title: 'Get customers for my business', sub: 'I already run a shop, service or practice and want more sales' },
  { key: 'gig', icon: 'wallet', title: 'Earn money doing tasks', sub: 'Pick up paid work when I’m free, like a gig or side job' },
  { key: 'other', icon: 'compass', title: 'Something else', sub: 'Just looking around for now' },
];

export const isEarnGoal = (v: unknown): v is EarnGoal => v === 'business' || v === 'gig' || v === 'other';

/**
 * One tap picks why this person earns. Used in first-run setup (Earn or Both) and in the Earn-side
 * worker setup. Takes its colours from the surrounding theme, so wrap it in `RoleTheme worker` for blue.
 */
export function EarnGoalPicker({ value, onChange }: { value: EarnGoal | null; onChange: (v: EarnGoal) => void }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup">
      {EARN_GOALS.map((g) => {
        const on = value === g.key;
        return (
          <Pressable
            key={g.key}
            onPress={() => onChange(g.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={`${g.title}. ${g.sub}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              marginTop: 10,
              borderRadius: 18,
              borderWidth: 1.5,
              borderColor: on ? t.colors.accent : t.colors.line,
              backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
            }}
          >
            <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: on ? t.colors.surface : t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={g.icon} size={20} color={t.colors.accentDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <RNText style={tx('800', 15, t.colors.ink)}>{g.title}</RNText>
              <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 3, lineHeight: 17 })}>{g.sub}</RNText>
            </View>
            {on ? <Icon name="check" size={18} color={t.colors.accentDeep} strokeWidth={2.4} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
