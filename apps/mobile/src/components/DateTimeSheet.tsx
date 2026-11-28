import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, Modal, Animated, Easing, type ScrollViewInstance } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { describeLeadTime, quickDeadlines } from '@taskdrop/rules';
import { tx } from './primitives';
import { useLayout } from '../lib/layout';
import { ClockFace } from './ClockFace';
import { floorMinute, firstAllowedMinute, isTimeAllowed, type TimeLimits } from '../lib/clockTime';

/**
 * "Complete by" — the one field every request hangs on, so it is worth making
 * pleasant.
 *
 * Built the way delivery and home-service apps do it: a strip of day cards you
 * flick through with a thumb, then a clock face for the time. The
 * full month calendar is still there for a date further out, one tap away.
 * Motion runs on the native driver (transform and opacity only) and never
 * blocks a tap while it plays.
 */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** How many day cards the strip shows before the calendar takes over. */
const STRIP_DAYS = 21;

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

function clock(h24: number, minute: number): string {
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(minute).padStart(2, '0')} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

export function formatDeadline(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}, ${clock(d.getHours(), d.getMinutes())}`;
}

function CalendarIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={5} width={17} height={15.5} rx={3} stroke={color} strokeWidth={1.8} />
      <Path d="M3.5 10h17M8 3v4M16 3v4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function ClockIcon({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={1.8} />
      <Path d="M12 7.5V12l3 2" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** A tappable card that springs a little when it becomes the selection. */
function Pop({ on, children }: { on: boolean; children: React.ReactNode }) {
  const pop = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.spring(pop, { toValue: on ? 1 : 0, useNativeDriver: true, friction: 5, tension: 180 });
    anim.start();
    return () => anim.stop();
  }, [on, pop]);
  const scale = pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1.08, 1] });
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

export function DateTimeSheet({
  visible,
  initial,
  onCancel,
  onConfirm,
  quick = true,
  onOpenEnded,
  openEndedLabel = 'No fixed date',
  openEndedHint = 'It stays open until you pick someone',
  minAt,
  maxAt,
  title = 'When should it be done?',
  subtitle = 'Workers plan their offers around this deadline.',
  confirmLabel = 'Set deadline',
}: {
  /** The words at the top and on the button; a task's own date says "Close this task by" (plan 1.19 K). */
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
  visible: boolean;
  initial?: Date;
  /** Show the one-tap deadlines row. Off where the screen already offers its own shortcuts. */
  quick?: boolean;
  onCancel: () => void;
  onConfirm: (d: Date) => void;
  /** When given, a first "No fixed date" option (tagged Recommended) that makes the task open-ended (plan 1.19 J). */
  onOpenEnded?: () => void;
  /** The words on that first option. */
  openEndedLabel?: string;
  /** The small line under it. */
  openEndedHint?: string;
  /** Earliest and latest time that may be picked (the earliest defaults to now). */
  minAt?: Date;
  maxAt?: Date;
}) {
  const t = useTheme();
  const { desktop } = useLayout();
  const base = initial ?? new Date(Date.now() + 24 * 3600 * 1000);

  const [picked, setPicked] = useState<Date>(startOfDay(base));
  const [h24, setH24] = useState(base.getHours());
  const [minute, setMinute] = useState(floorMinute(base.getMinutes()));
  const [showCalendar, setShowCalendar] = useState(false);
  const [cursor, setCursor] = useState(new Date(base.getFullYear(), base.getMonth(), 1));
  const [note, setNote] = useState<string | null>(null);

  const today = startOfDay(new Date());
  const stripRef = useRef<ScrollViewInstance>(null);

  // ---- sheet motion -------------------------------------------------------
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      rise.setValue(0);
      return;
    }
    const anim = Animated.spring(rise, { toValue: 1, useNativeDriver: true, friction: 9, tension: 70 });
    anim.start();
    return () => anim.stop();
  }, [visible, rise]);
  const sheetY = rise.interpolate({ inputRange: [0, 1], outputRange: [520, 0] });

  // ---- calendar month motion ----------------------------------------------
  const slide = useRef(new Animated.Value(0)).current;
  const shiftMonth = useCallback(
    (by: number) => {
      slide.setValue(0);
      Animated.timing(slide, { toValue: -by, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(
        ({ finished }) => {
          if (!finished) return;
          setCursor((c) => new Date(c.getFullYear(), c.getMonth() + by, 1));
          slide.setValue(by);
          Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 8, tension: 90 }).start();
        },
      );
    },
    [slide],
  );
  const gridX = slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [-40, 0, 40] });
  const gridFade = slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.2, 1, 0.2] });
  const grid = useMemo(() => buildGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);

  const strip = useMemo(
    () => Array.from({ length: STRIP_DAYS }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today.getTime()],
  );

  const result = useMemo(() => {
    const d = new Date(picked);
    d.setHours(h24, minute, 0, 0);
    return d;
  }, [picked, h24, minute]);

  const limits: TimeLimits = useMemo(() => ({ min: minAt, max: maxAt }), [minAt, maxAt]);
  const inPast = !isTimeAllowed(picked, h24, minute, limits);

  // A rejected tap should say why, and stop saying it once the user moves on.
  const say = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote((n) => (n === msg ? null : n)), 2600);
  };

  const applyAt = (at: Date) => {
    setPicked(startOfDay(at));
    setCursor(new Date(at.getFullYear(), at.getMonth(), 1));
    setH24(at.getHours());
    setMinute(floorMinute(at.getMinutes()));
    setNote(null);
  };

  // Open on whatever deadline the screen is showing right now, not the one it
  // had when the sheet first mounted.
  useEffect(() => {
    if (!visible) return;
    if (initial) applyAt(initial);
    setShowCalendar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Keep the chosen day card in view, including when it came from the calendar.
  useEffect(() => {
    if (!visible) return;
    const idx = Math.round((picked.getTime() - today.getTime()) / 86_400_000);
    if (idx >= 0 && idx < STRIP_DAYS) {
      stripRef.current?.scrollTo({ x: Math.max(0, idx * 70 - 70), animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, visible]);

  const presets = useMemo(() => quickDeadlines(new Date()), []);

  const pickDay = (d: Date) => {
    setPicked(d);
    setNote(null);
    // Today with a time already gone by: move to the first time still ahead.
    if (!isTimeAllowed(d, h24, minute, limits)) {
      for (let h = h24; h < 24; h++) {
        const m = firstAllowedMinute(d, h, limits);
        if (m !== null) {
          setH24(h);
          setMinute(m);
          return;
        }
      }
    }
  };

  const confirm = () => {
    if (inPast) {
      say(maxAt && result.getTime() > maxAt.getTime() ? 'That is later than allowed. Pick an earlier time.' : 'Pick a time in the future — workers plan their offers around this deadline.');
      return;
    }
    onConfirm(result);
  };

  const sectionLabel = (icon: React.ReactNode, label: string, right?: React.ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
        {icon}
        <RNText style={tx('700', 13, t.colors.ink, { letterSpacing: 0.2 })}>{label}</RNText>
      </View>
      {right}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <Animated.View
        style={{
          flex: 1,
          justifyContent: desktop ? 'center' : 'flex-end',
          alignItems: desktop ? 'center' : 'stretch',
          backgroundColor: 'rgba(0,0,0,0.5)',
          opacity: rise,
        }}
      >
        <Pressable
          style={desktop ? { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } : { flex: 1 }}
          onPress={onCancel}
          accessibilityLabel="Close"
        />
        <Animated.View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            ...(desktop ? { borderRadius: 28, width: 520 } : null),
            paddingBottom: 24,
            maxHeight: '90%',
            transform: [{ translateY: desktop ? Animated.multiply(sheetY, 0.1) : sheetY }],
          }}
        >
          <View style={{ paddingTop: 12, alignItems: 'center' }}>
            <View style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: t.colors.line }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingTop: 16 }} showsVerticalScrollIndicator={false}>
            <View style={{ paddingHorizontal: 20 }}>
              <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.5 })}>{title}</RNText>
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4 })}>
                {subtitle}
              </RNText>
            </View>

            {/* No fixed date first and tagged Recommended: most posters tap this (plan 1.21 B). */}
            {onOpenEnded ? (
              <Pressable
                onPress={onOpenEnded}
                accessibilityRole="button"
                accessibilityLabel={`${openEndedLabel}. Recommended. ${openEndedHint}`}
                style={({ pressed }) => ({
                  marginTop: 16,
                  marginHorizontal: 20,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: t.colors.accent,
                  backgroundColor: t.colors.accentSoft,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface }}>
                  <CalendarIcon color={t.colors.accentDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <RNText style={tx('800', 15, t.colors.ink)}>{openEndedLabel}</RNText>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: t.colors.btn }}>
                      <RNText style={tx('700', 11, t.colors.onAccent)}>Recommended</RNText>
                    </View>
                  </View>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>{openEndedHint}</RNText>
                </View>
              </Pressable>
            ) : null}

            {/* An "or" between the two choices, so picking a date reads as the second option, not more of the first (owner, 28 Nov). */}
            {onOpenEnded ? (
              <View style={{ marginTop: 18, paddingHorizontal: 20 }}>
                <View
                  accessibilityRole="text"
                  accessibilityLabel="or"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
                  <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, textTransform: 'uppercase' })}>or</RNText>
                  <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
                </View>
                <RNText accessibilityRole="header" style={tx('800', 15, t.colors.ink, { marginTop: 14 })}>
                  Pick a closing date and time
                </RNText>
              </View>
            ) : null}

            {/* The deadlines people actually want, one tap away. */}
            {quick ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: onOpenEnded ? 10 : 16 }}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
              >
                {presets.map((q) => {
                  const on = Math.abs(q.at.getTime() - result.getTime()) < 60_000;
                  return (
                    <Pressable
                      key={q.label}
                      onPress={() => applyAt(q.at)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => ({
                        paddingVertical: 9,
                        paddingHorizontal: 14,
                        borderRadius: 999,
                        backgroundColor: on ? t.colors.ink : t.colors.surface,
                        borderWidth: 1,
                        borderColor: on ? t.colors.ink : t.colors.line,
                        transform: [{ scale: pressed ? 0.95 : 1 }],
                      })}
                    >
                      <RNText style={tx('700', 13, on ? t.colors.bg : t.colors.ink)}>{q.label}</RNText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            <View style={{ paddingHorizontal: 20 }}>
              {sectionLabel(
                <CalendarIcon color={t.colors.accentDeep} />,
                'Date',
                <Pressable
                  onPress={() => setShowCalendar((s) => !s)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={showCalendar ? 'Hide calendar' : 'Show full calendar'}
                >
                  <RNText style={tx('700', 13, t.colors.accentDeep)}>{showCalendar ? 'Hide calendar' : 'Full calendar'}</RNText>
                </Pressable>,
              )}
            </View>

            {showCalendar ? (
              <View
                style={{
                  marginHorizontal: 20,
                  padding: 14,
                  borderRadius: 20,
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Pressable onPress={() => shiftMonth(-1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous month">
                    <RNText style={tx('700', 22, t.colors.ink)}>‹</RNText>
                  </Pressable>
                  <RNText style={tx('700', 15, t.colors.ink)}>
                    {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
                  </RNText>
                  <Pressable onPress={() => shiftMonth(1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next month">
                    <RNText style={tx('700', 22, t.colors.ink)}>›</RNText>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                  {WEEKDAYS.map((w, i) => (
                    <RNText key={`${w}${i}`} style={tx('600', 11, t.colors.muted, { flex: 1, textAlign: 'center' })}>
                      {w}
                    </RNText>
                  ))}
                </View>
                <Animated.View
                  style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, opacity: gridFade, transform: [{ translateX: gridX }] }}
                >
                  {grid.map((day, i) => {
                    if (!day) return <View key={`x${i}`} style={{ width: `${100 / 7}%`, height: 40 }} />;
                    const selected = day.getTime() === picked.getTime();
                    const isPast = day < today;
                    const isToday = day.getTime() === today.getTime();
                    return (
                      <View key={day.toISOString()} style={{ width: `${100 / 7}%`, height: 40, padding: 3 }}>
                        <Pressable
                          onPress={() => (isPast ? say('That day has already gone by.') : pickDay(day))}
                          accessibilityRole="button"
                          accessibilityLabel={`${day.getDate()} ${MONTHS[day.getMonth()]}`}
                          accessibilityState={{ selected, disabled: isPast }}
                          style={{
                            flex: 1,
                            borderRadius: 999,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: selected ? t.colors.btn : 'transparent',
                            borderWidth: !selected && isToday ? 1 : 0,
                            borderColor: t.colors.accent,
                            opacity: isPast ? 0.28 : 1,
                          }}
                        >
                          <RNText style={tx('600', 14, selected ? t.colors.onAccent : t.colors.ink)}>{day.getDate()}</RNText>
                        </Pressable>
                      </View>
                    );
                  })}
                </Animated.View>
              </View>
            ) : (
              <ScrollView
                ref={stripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
              >
                {strip.map((d, i) => {
                  const on = d.getTime() === picked.getTime();
                  const top = i === 0 ? 'Today' : i === 1 ? 'Tmrw' : WEEKDAY_SHORT[d.getDay()]!;
                  return (
                    <Pop key={d.toISOString()} on={on}>
                      <Pressable
                        onPress={() => pickDay(d)}
                        accessibilityRole="button"
                        accessibilityLabel={`${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`}
                        accessibilityState={{ selected: on }}
                        style={{
                          width: 62,
                          paddingVertical: 12,
                          borderRadius: 18,
                          alignItems: 'center',
                          backgroundColor: on ? t.colors.btn : t.colors.surface,
                          borderWidth: 1,
                          borderColor: on ? t.colors.accent : t.colors.line,
                          shadowColor: t.colors.accent,
                          shadowOpacity: on ? 0.28 : 0,
                          shadowRadius: 10,
                          shadowOffset: { width: 0, height: 4 },
                          elevation: on ? 4 : 0,
                        }}
                      >
                        <RNText style={tx('600', 11, on ? t.colors.onAccent : t.colors.muted)}>{top}</RNText>
                        <RNText style={tx('800', 20, on ? t.colors.onAccent : t.colors.ink, { marginTop: 3 })}>{d.getDate()}</RNText>
                        <RNText style={tx('600', 11, on ? t.colors.onAccent : t.colors.muted, { marginTop: 1 })}>
                          {MONTHS[d.getMonth()]!.slice(0, 3)}
                        </RNText>
                      </Pressable>
                    </Pop>
                  );
                })}
              </ScrollView>
            )}

            <View style={{ paddingHorizontal: 20 }}>
              {sectionLabel(<ClockIcon color={t.colors.accentDeep} />, 'Time')}

              <ClockFace
                day={picked}
                h24={h24}
                minute={minute}
                limits={limits}
                onChange={(h, m) => {
                  setH24(h);
                  setMinute(m);
                  setNote(null);
                }}
                onRejected={say}
              />

              {/* What the choice actually means, in words. */}
              <View
                style={{
                  marginTop: 18,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: inPast ? t.colors.signalSoft : t.colors.accentSoft,
                  borderWidth: 1,
                  borderColor: inPast ? t.colors.signal : t.colors.accentBorder,
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: inPast ? t.colors.signal : t.colors.btn,
                  }}
                >
                  <ClockIcon color={t.colors.onAccent} />
                </View>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('800', 15, inPast ? t.colors.signalDeep : t.colors.accentDeep)}>
                    {WEEKDAY_SHORT[result.getDay()]}, {formatDeadline(result)}
                  </RNText>
                  <RNText style={tx('500', 12, inPast ? t.colors.signalDeep : t.colors.accentDeep, { marginTop: 2 })}>
                    {describeLeadTime(result)}
                  </RNText>
                </View>
              </View>

              {note ? (
                <RNText style={tx('500', 12, t.colors.signalDeep, { marginTop: 10, lineHeight: 18 })}>{note}</RNText>
              ) : null}
            </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 14 }}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: 999,
                paddingVertical: 15,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: t.colors.line,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <RNText style={tx('700', 15, t.colors.muted)}>Cancel</RNText>
            </Pressable>
            <Pressable
              onPress={confirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              style={({ pressed }) => ({
                flex: 2,
                borderRadius: 999,
                paddingVertical: 15,
                alignItems: 'center',
                backgroundColor: inPast ? t.colors.surface2 : t.colors.btn,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <RNText style={tx('700', 15, inPast ? t.colors.muted : t.colors.onAccent)}>{confirmLabel}</RNText>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
