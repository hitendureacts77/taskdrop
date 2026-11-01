import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Screen, cardSurface } from '../components/ui';
import { Field, LoadFailed, PrimaryButton, Shimmer, TopBar, rupees } from '../components/kit';
import { Icon } from '../components/Icon';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { myStreaks, setWeeklyGoal, type Streaks } from '../data/api';
import { STREAK_GOAL, badgesFor, daysLeftInWeek, goalProgress } from '../lib/streaks';
import { reportError } from '../lib/errors';

const RING = 136;
const STROKE = 14;

/**
 * The Earn side's week (migration 134): a weekly goal the helper sets, the
 * on-time streak, and badges. On top of levels, never instead of them.
 */
export function StreaksScreen() {
  const t = useTheme();
  const { back } = useNav();
  const { flash } = useActions();
  const [s, setS] = useState<Streaks | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setS(await myStreaks());
    setFailed(false);
  }, []);
  useEffect(() => {
    void load().catch((e) => {
      reportError(e, 'streaks');
      setFailed(true);
    });
  }, [load]);

  if (failed && !s) {
    return (
      <Screen padded={false}>
        <TopBar title="Streaks and badges" onBack={back} />
        <LoadFailed title="Couldn’t load your week" onRetry={() => void load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (!s) {
    return (
      <Screen padded={false}>
        <TopBar title="Streaks and badges" onBack={back} />
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <Shimmer height={170} />
          <Shimmer height={90} />
          <Shimmer height={220} />
        </View>
      </Screen>
    );
  }

  const goal = goalProgress(s);
  const days = daysLeftInWeek(s.weekStart);
  const badges = badgesFor(s);
  const earned = badges.filter((b) => b.earned).length;
  const circ = Math.PI * (RING - STROKE);

  const saveGoal = async () => {
    const rupeesTyped = Math.round(Number(goalText.replace(/[^0-9]/g, '')));
    if (saving) return;
    setSaving(true);
    try {
      await setWeeklyGoal(rupeesTyped > 0 ? rupeesTyped * 100 : null);
      setEditing(false);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save your goal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen padded={false}>
      <TopBar title="Streaks and badges" subtitle="This week, Monday to Sunday" onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        <FadeIn translateY={10}>
          <View style={{ ...cardSurface(t, 22), padding: 18, flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={RING} height={RING} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={RING / 2} cy={RING / 2} r={(RING - STROKE) / 2} stroke={t.colors.purpleSoft} strokeWidth={STROKE} fill="none" />
                <Circle
                  cx={RING / 2}
                  cy={RING / 2}
                  r={(RING - STROKE) / 2}
                  stroke={t.colors.purple}
                  strokeWidth={STROKE}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${circ} ${circ}`}
                  strokeDashoffset={circ * (1 - (goal?.share ?? 0))}
                />
              </Svg>
              <RNText style={tx('800', 20, t.colors.ink, { fontVariant: ['tabular-nums'], letterSpacing: -0.4 })}>
                {rupees(s.weekEarnedMinor / 100)}
              </RNText>
              <RNText style={tx('600', 11, t.colors.muted)}>
                {s.weeklyGoalMinor ? `of ${rupees(s.weeklyGoalMinor / 100)}` : 'this week'}
              </RNText>
            </View>
            <View style={{ flex: 1 }}>
              <RNText style={tx('700', 11, t.colors.purpleDeep, { letterSpacing: 1.2 })}>WEEKLY GOAL</RNText>
              <RNText style={tx('800', 16, t.colors.ink, { marginTop: 6, lineHeight: 21 })}>
                {goal
                  ? goal.toGoMinor === 0
                    ? 'Goal reached. Well done'
                    : `${rupees(goal.toGoMinor / 100)} to go, ${days} day${days === 1 ? '' : 's'} left`
                  : 'Set a goal for the week'}
              </RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
                {s.weekJobs} job{s.weekJobs === 1 ? '' : 's'} done this week, after commission
              </RNText>
              <Pressable
                onPress={() => {
                  setGoalText(s.weeklyGoalMinor ? String(Math.round(s.weeklyGoalMinor / 100)) : '');
                  setEditing((e) => !e);
                }}
                accessibilityRole="button"
                style={{ alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 14, height: 34, borderRadius: 999, borderWidth: 1, borderColor: t.colors.line, justifyContent: 'center' }}
              >
                <RNText style={tx('700', 12, t.colors.ink)}>{s.weeklyGoalMinor ? 'Change goal' : 'Set a goal'}</RNText>
              </Pressable>
            </View>
          </View>
        </FadeIn>

        {editing ? (
          <View style={{ ...cardSurface(t, 18), padding: 16, marginTop: 12 }}>
            <Field
              label="Weekly goal (₹)"
              value={goalText}
              onChangeText={setGoalText}
              keyboardType="number-pad"
              maxLength={7}
              hint="Leave it empty to clear your goal"
              autoFocus
            />
            <PrimaryButton label="Save goal" onPress={() => void saveGoal()} busy={saving} style={{ marginTop: 12 }} />
          </View>
        ) : null}

        <FadeIn translateY={10} delay={60}>
          <View style={{ borderRadius: 22, padding: 18, marginTop: 12, backgroundColor: t.colors.purpleSoft }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <RNText style={tx('800', 16, t.colors.ink, { flex: 1 })}>
                On-time streak: {s.onTimeStreak} job{s.onTimeStreak === 1 ? '' : 's'}
              </RNText>
              <RNText style={tx('600', 12, t.colors.purpleDeep)}>Badge at {STREAK_GOAL}</RNText>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }} accessibilityLabel={`${Math.min(s.onTimeStreak, STREAK_GOAL)} of ${STREAK_GOAL}`}>
              {Array.from({ length: STREAK_GOAL }, (_, i) => (
                <View
                  key={i}
                  style={{ flex: 1, height: 10, borderRadius: 10, backgroundColor: i < s.onTimeStreak ? t.colors.purple : t.colors.line }}
                />
              ))}
            </View>
            <RNText style={tx('400', 12, t.colors.text, { marginTop: 10, lineHeight: 17 })}>
              A job counts when you mark it done before its deadline. A late one starts the count again.
            </RNText>
          </View>
        </FadeIn>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 10 }}>
          <RNText style={tx('800', 18, t.colors.ink, { flex: 1, letterSpacing: -0.3 })}>Badges</RNText>
          <RNText style={tx('700', 13, t.colors.purpleDeep)}>
            {earned} of {badges.length}
          </RNText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {badges.map((b, i) => (
            <FadeIn key={b.key} translateY={8} delay={Math.min(i, t.motion.staggerMax) * t.motion.stagger} style={{ width: '31%', flexGrow: 1 }}>
              <View style={{ ...cardSurface(t, 18), padding: 12, alignItems: 'center', minHeight: 130 }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: !b.earned ? t.colors.surface2 : b.tone === 'gold' ? t.colors.goldSoft : t.colors.purpleSoft,
                  }}
                >
                  <Icon
                    name={b.earned ? 'trophy' : 'lock'}
                    size={21}
                    color={!b.earned ? t.colors.muted : b.tone === 'gold' ? t.colors.goldInk : t.colors.purpleDeep}
                    strokeWidth={2}
                  />
                </View>
                <RNText style={tx('800', 12, t.colors.ink, { marginTop: 8, textAlign: 'center' })}>{b.name}</RNText>
                <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3, textAlign: 'center' })}>{b.hint}</RNText>
              </View>
            </FadeIn>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
