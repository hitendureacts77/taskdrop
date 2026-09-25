import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, Modal, Animated, Easing } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { describeLeadTime, quickDeadlines } from '@taskdrop/rules';
import { tx } from './primitives';
import { ClockDial } from './ClockDial';

/**
 * "Complete by" — the one field every request hangs on, so it is worth making
 * pleasant.
 *
 * The motion here is deliberate rather than decorative: the sheet springs up so
 * it feels physical, a month change slides in the direction you travelled so you
 * keep your bearings, and a chosen day pops so the tap is unmistakable. All of
 * it runs on the native driver (transform and opacity only) and none of it
 * blocks a tap while it plays.
 */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function buildGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Sun=0 -> Mon-first
  const count = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push(new Date(year, month, d));
  return cells;
}

export function formatDeadline(d: Date): string {
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = h24 >= 12 ? 'PM' : 'AM';
  return `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}, ${h}:${mm} ${ap}`;
}

/** A day cell that pops when it becomes the selection. */
function DayCell({
  day,
  selected,
  isToday,
  isPast,
  onPick,
  onRejectPast,
  colors,
}: {
  day: Date;
  selected: boolean;
  isToday: boolean;
  isPast: boolean;
  onPick: (d: Date) => void;
  onRejectPast: () => void;
  colors: { accent: string; onAccent: string; ink: string };
}) {
  const pop = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.spring(pop, {
      toValue: selected ? 1 : 0,
      useNativeDriver: true,
      friction: 5,
      tension: 180,
    });
    anim.start();
    return () => anim.stop();
  }, [selected, pop]);

  const scale = pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1.18, 1] });

  return (
    <View style={{ width: `${100 / 7}%`, height: 42, padding: 3 }}>
      <Pressable
        // Past days stay tappable so the sheet can explain rather than ignore.
        onPress={() => (isPast ? onRejectPast() : onPick(day))}
        accessibilityRole="button"
        accessibilityLabel={`${day.getDate()} ${MONTHS[day.getMonth()]}`}
        accessibilityState={{ selected, disabled: isPast }}
        style={{ flex: 1 }}
      >
        <Animated.View
          style={{
            flex: 1,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? colors.accent : 'transparent',
            borderWidth: !selected && isToday ? 1 : 0,
            borderColor: colors.accent,
            opacity: isPast ? 0.28 : 1,
            transform: [{ scale }],
          }}
        >
          <RNText style={tx('600', 14, selected ? colors.onAccent : colors.ink)}>
            {day.getDate()}
          </RNText>
        </Animated.View>
      </Pressable>
    </View>
  );
}

export function DateTimeSheet({
  visible,
  initial,
  onCancel,
  onConfirm,
  quick = true,
}: {
  visible: boolean;
  initial?: Date;
  /** Show the one-tap deadlines row. Off where the screen already offers its own shortcuts. */
  quick?: boolean;
  onCancel: () => void;
  onConfirm: (d: Date) => void;
}) {
  const t = useTheme();
  const base = initial ?? new Date(Date.now() + 24 * 3600 * 1000);

  const [cursor, setCursor] = useState(new Date(base.getFullYear(), base.getMonth(), 1));
  const [picked, setPicked] = useState<Date>(startOfDay(base));
  const [hour, setHour] = useState(base.getHours() % 12 === 0 ? 12 : base.getHours() % 12);
  const [minute, setMinute] = useState((Math.round(base.getMinutes() / 5) * 5) % 60);
  const [pm, setPm] = useState(base.getHours() >= 12);
  const [note, setNote] = useState<string | null>(null);
  // Which half of the clock the dial is editing.
  const [dialMode, setDialMode] = useState<'hour' | 'minute'>('hour');

  const today = startOfDay(new Date());

  // ---- sheet motion -------------------------------------------------------
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      rise.setValue(0);
      return;
    }
    setDialMode('hour');
    const anim = Animated.spring(rise, {
      toValue: 1,
      useNativeDriver: true,
      friction: 9,
      tension: 70,
    });
    anim.start();
    return () => anim.stop();
  }, [visible, rise]);

  const sheetY = rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });

  // ---- month motion -------------------------------------------------------
  const slide = useRef(new Animated.Value(0)).current;
  const shiftMonth = useCallback(
    (by: number) => {
      // Leave in the direction of travel, return from the opposite side.
      slide.setValue(0);
      Animated.timing(slide, {
        toValue: -by,
        duration: 110,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setCursor((c) => new Date(c.getFullYear(), c.getMonth() + by, 1));
        slide.setValue(by);
        Animated.spring(slide, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
          tension: 90,
        }).start();
      });
    },
    [slide],
  );

  const gridX = slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [-40, 0, 40] });
  const gridFade = slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.2, 1, 0.2] });

  const grid = useMemo(() => buildGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const result = useMemo(() => {
    const d = new Date(picked);
    const h24 = pm ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
    d.setHours(h24, minute, 0, 0);
    return d;
  }, [picked, hour, minute, pm]);

  const inPast = result.getTime() <= Date.now();

  // A rejected tap should say why, and stop saying it once the user moves on.
  const say = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote((n) => (n === msg ? null : n)), 2600);
  };

  const applyQuick = (at: Date) => {
    setPicked(startOfDay(at));
    setCursor(new Date(at.getFullYear(), at.getMonth(), 1));
    const h = at.getHours();
    setHour(h % 12 === 0 ? 12 : h % 12);
    setMinute((Math.round(at.getMinutes() / 5) * 5) % 60);
    setPm(h >= 12);
    setNote(null);
  };

  // Open on whatever deadline the screen is showing right now, not the one it
  // had when the sheet first mounted.
  useEffect(() => {
    if (visible && initial) applyQuick(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const presets = useMemo(() => quickDeadlines(new Date()), []);

  const chip = (label: string, on: boolean, onPress: () => void, wide = false) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({
        minWidth: wide ? 54 : 42,
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: 10,
        alignItems: 'center',
        backgroundColor: on ? t.colors.accentSoft : 'transparent',
        borderWidth: 1,
        borderColor: on ? t.colors.accent : t.colors.line,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <RNText style={tx('600', 13, on ? t.colors.ink : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );

  const confirm = () => {
    if (inPast) {
      say('Pick a time in the future — workers quote against this deadline.');
      return;
    }
    onConfirm(result);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <Animated.View
        style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: 'rgba(0,0,0,0.45)',
          opacity: rise,
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={onCancel} accessibilityLabel="Close" />
        <Animated.View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: 24,
            maxHeight: '88%',
            transform: [{ translateY: sheetY }],
          }}
        >
          <View style={{ paddingTop: 12, alignItems: 'center' }}>
            <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: t.colors.line }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>Complete by</RNText>

            {/* The deadlines people actually want, one tap away. */}
            {quick ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 14 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {presets.map((q) =>
                  chip(
                    q.label,
                    Math.abs(q.at.getTime() - result.getTime()) < 60_000,
                    () => applyQuick(q.at),
                    true,
                  ),
                )}
              </View>
            </ScrollView>
            ) : null}

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: quick ? 18 : 14,
              }}
            >
              <Pressable
                onPress={() => shiftMonth(-1)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <RNText style={tx('700', 20, t.colors.ink)}>‹</RNText>
              </Pressable>
              <RNText style={tx('700', 15, t.colors.ink)}>
                {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
              </RNText>
              <Pressable
                onPress={() => shiftMonth(1)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <RNText style={tx('700', 20, t.colors.ink)}>›</RNText>
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', marginTop: 14 }}>
              {WEEKDAYS.map((w, i) => (
                <RNText
                  key={`${w}${i}`}
                  style={tx('600', 11, t.colors.muted, { flex: 1, textAlign: 'center' })}
                >
                  {w}
                </RNText>
              ))}
            </View>

            <Animated.View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                marginTop: 6,
                opacity: gridFade,
                transform: [{ translateX: gridX }],
              }}
            >
              {grid.map((day, i) =>
                day ? (
                  <DayCell
                    key={day.toISOString()}
                    day={day}
                    selected={day.getTime() === picked.getTime()}
                    isToday={day.getTime() === today.getTime()}
                    isPast={day < today}
                    onPick={(d) => {
                      setPicked(d);
                      setNote(null);
                    }}
                    onRejectPast={() => say('That day has already gone by.')}
                    colors={{
                      accent: t.colors.accent,
                      onAccent: t.colors.onAccent,
                      ink: t.colors.ink,
                    }}
                  />
                ) : (
                  <View key={`x${i}`} style={{ width: `${100 / 7}%`, height: 42 }} />
                ),
              )}
            </Animated.View>

            <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 20 })}>
              TIME
            </RNText>

            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <ClockDial
                hour={hour}
                minute={minute}
                mode={dialMode}
                onModeChange={setDialMode}
                onChange={(next) => {
                  if (next.hour !== undefined) {
                    setHour(next.hour);
                    // Setting the hour is almost always followed by the
                    // minutes, so move the dial on rather than making them tap.
                    setDialMode('minute');
                  }
                  if (next.minute !== undefined) setMinute(next.minute);
                  setNote(null);
                }}
              />

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                {chip('AM', !pm, () => setPm(false), true)}
                {chip('PM', pm, () => setPm(true), true)}
              </View>
            </View>

            {/* What the choice actually means, in words. */}
            <View
              style={{
                marginTop: 18,
                padding: 13,
                borderRadius: 12,
                backgroundColor: inPast ? t.colors.surface2 : t.colors.accentSoft,
                borderWidth: 1,
                borderColor: inPast ? t.colors.line : t.colors.accentBorder,
              }}
            >
              <RNText style={tx('700', 14, inPast ? t.colors.signal : t.colors.accentDeep)}>
                {formatDeadline(result)}
              </RNText>
              <RNText
                style={tx('400', 12, inPast ? t.colors.signal : t.colors.accentDeep, { marginTop: 3 })}
              >
                {describeLeadTime(result)}
              </RNText>
            </View>

            {note ? (
              <RNText style={tx('400', 12, t.colors.signal, { marginTop: 10, lineHeight: 18 })}>
                {note}
              </RNText>
            ) : null}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 14 }}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={{
                flex: 1,
                borderRadius: 999,
                paddingVertical: 15,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: t.colors.line,
              }}
            >
              <RNText style={tx('700', 15, t.colors.muted)}>Cancel</RNText>
            </Pressable>
            <Pressable
              onPress={confirm}
              accessibilityRole="button"
              accessibilityLabel="Set deadline"
              style={{
                flex: 2,
                borderRadius: 999,
                paddingVertical: 15,
                alignItems: 'center',
                backgroundColor: inPast ? t.colors.surface2 : t.colors.accent,
              }}
            >
              <RNText style={tx('700', 15, inPast ? t.colors.muted : t.colors.onAccent)}>
                Set deadline
              </RNText>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
