import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated, Easing } from 'react-native';
import { Icon, type IconName } from './Icon';
import { tx } from './primitives';
import { cardSurface } from './ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { useReducedMotion } from '../lib/motion';
import { setRepeat, type Task } from '../data/api';

/**
 * The options a poster switched on for this task (migration 134), on the
 * task's own page: the Flash Drop countdown, the crew, who was asked first,
 * Repeat (which can be switched off here), and the photos asked for.
 * Shows nothing for a task with no options.
 */
export function TaskOptionsPanel({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const t = useTheme();
  const { go } = useNav();
  const { flash } = useActions();
  const [saving, setSaving] = useState(false);
  const now = useNow(task.flash_until || task.preferred_until ? 1000 : 0);

  const open = task.status === 'OPEN';
  const flashLeft = open && task.flash_until ? new Date(task.flash_until).getTime() - now : 0;
  const preferLeft = open && task.preferred_until ? new Date(task.preferred_until).getTime() - now : 0;
  const canRepeat = !task.crew_id && task.status !== 'CANCELLED';
  const any =
    flashLeft > 0 || task.crew_id || preferLeft > 0 || task.repeat_every || task.want_photos || task.live_answer || task.repeated_from;
  if (!any && !canRepeat) return null;

  const toggleRepeat = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await setRepeat(task.id, task.repeat_every ? null : 'week');
      flash(task.repeat_every ? 'It won’t be posted again' : 'When it’s done, the next one is posted for a week later');
      onChanged();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not change that');
    } finally {
      setSaving(false);
    }
  };

  const line = (icon: IconName, head: string, sub: string, right?: React.ReactNode) => (
    <View key={head} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={t.colors.accentDeep} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <RNText style={tx('700', 14, t.colors.ink)}>{head}</RNText>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2, lineHeight: 17 })}>{sub}</RNText>
      </View>
      {right}
    </View>
  );

  return (
    <>
      {flashLeft > 0 ? <FlashCountdown msLeft={flashLeft} /> : null}
      <View style={{ ...cardSurface(t, 18), paddingHorizontal: 15, paddingVertical: 5, marginTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingBottom: 2 }}>
          <Icon name="sparkle" size={16} color={t.colors.accentDeep} />
          <RNText style={tx('800', 15, t.colors.ink)}>Options</RNText>
        </View>
        {task.crew_id && task.crew_size
          ? line(
              'users',
              `Crew · helper ${task.crew_slot} of ${task.crew_size}`,
              'Each helper is hired and paid on their own. One chat for the whole crew.',
              <Pressable onPress={() => go('crew', { crewId: task.crew_id, member: true })} accessibilityRole="button" hitSlop={8}>
                <RNText style={tx('700', 13, t.colors.accentDeep)}>See crew</RNText>
              </Pressable>,
            )
          : null}
        {preferLeft > 0
          ? line('heart', 'Offered first to someone you hired', `Everyone else can send offers in ${Math.ceil(preferLeft / 60000)} min`)
          : null}
        {task.live_answer ? line('eye', 'Live answer', 'The answer comes as a live photo taken in the app') : null}
        {task.want_photos
          ? line(
              'camera',
              'Before-and-after photos',
              task.photos_public ? 'Asked for. The helper may show them on their profile' : 'Asked for, with the proof of work',
            )
          : null}
        {task.repeated_from ? line('repeat', 'Posted again by itself', 'From the same task last time') : null}
        {canRepeat
          ? line(
              'repeat',
              task.repeat_every ? `Repeats every ${task.repeat_every}` : 'Repeat when done',
              task.repeat_every ? 'When it is done, the next one is posted by itself' : 'Post the same task again automatically',
              <Pressable
                onPress={() => void toggleRepeat()}
                disabled={saving}
                accessibilityRole="switch"
                accessibilityLabel="Repeat this task"
                accessibilityState={{ checked: !!task.repeat_every, disabled: saving }}
                hitSlop={8}
                style={{
                  width: 48,
                  height: 28,
                  borderRadius: 999,
                  padding: 3,
                  backgroundColor: task.repeat_every ? t.colors.accent : t.colors.line,
                  alignItems: task.repeat_every ? 'flex-end' : 'flex-start',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <View style={{ width: 22, height: 22, borderRadius: 22, backgroundColor: t.colors.surface }} />
              </Pressable>,
            )
          : null}
      </View>
    </>
  );
}

/** The clock, ticking every `everyMs` (0 = still). */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!everyMs) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

/** Flash Drop's 30 minutes: rings pulsing out from the middle, and the time left. */
function FlashCountdown({ msLeft }: { msLeft: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  const mins = Math.floor(msLeft / 60000);
  const secs = Math.floor((msLeft % 60000) / 1000);
  const ring = (delay: number) => {
    const p = Animated.modulo(Animated.add(pulse, new Animated.Value(delay)), 1);
    return (
      <Animated.View
        style={{
          position: 'absolute',
          width: 120,
          height: 120,
          borderRadius: 120,
          borderWidth: 2,
          borderColor: t.colors.signal,
          opacity: reduced ? 0.25 : p.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
          transform: [{ scale: reduced ? 1 : p.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.2] }) }],
        }}
      />
    );
  };
  return (
    <View
      style={{
        marginTop: 12,
        borderRadius: 18,
        padding: 16,
        backgroundColor: t.colors.signalSoft,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        overflow: 'hidden',
      }}
      accessibilityLabel={`Flash Drop, ${mins} minutes ${secs} seconds left`}
    >
      <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
        {ring(0)}
        {ring(0.5)}
        <View style={{ width: 60, height: 60, borderRadius: 60, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('800', 16, t.colors.ink, { fontVariant: ['tabular-nums'] })}>
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </RNText>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="bolt" size={14} color={t.colors.signalDeep} strokeWidth={2.4} />
          <RNText style={tx('800', 12, t.colors.signalDeep, { letterSpacing: 1 })}>FLASH DROP</RNText>
        </View>
        <RNText style={tx('800', 16, t.colors.ink, { marginTop: 4 })}>Finding someone now</RNText>
        <RNText style={tx('400', 12, t.colors.text, { marginTop: 3, lineHeight: 17 })}>
          Helpers nearby were told. The first one to accept at your price gets it.
        </RNText>
      </View>
    </View>
  );
}
