import { useMemo, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, Modal } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Days laid out Monday-first, padded so the 1st lands in the right column. */
function buildGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Sun=0 -> Mon-first
  const count = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d += 1) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function formatDeadline(d: Date): string {
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ap = h24 >= 12 ? 'PM' : 'AM';
  return `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}, ${h}:${mm} ${ap}`;
}

export function DateTimeSheet({
  visible,
  initial,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  initial?: Date;
  onCancel: () => void;
  onConfirm: (d: Date) => void;
}) {
  const t = useTheme();
  const base = initial ?? new Date(Date.now() + 24 * 3600 * 1000);

  const [cursor, setCursor] = useState(new Date(base.getFullYear(), base.getMonth(), 1));
  const [picked, setPicked] = useState<Date>(startOfDay(base));
  const [hour, setHour] = useState(base.getHours() % 12 === 0 ? 12 : base.getHours() % 12);
  const [minute, setMinute] = useState(Math.round(base.getMinutes() / 5) * 5 % 60);
  const [pm, setPm] = useState(base.getHours() >= 12);

  const today = startOfDay(new Date());
  const grid = useMemo(
    () => buildGrid(cursor.getFullYear(), cursor.getMonth()),
    [cursor],
  );

  const result = useMemo(() => {
    const d = new Date(picked);
    const h24 = pm ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
    d.setHours(h24, minute, 0, 0);
    return d;
  }, [picked, hour, minute, pm]);

  const shiftMonth = (by: number) =>
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + by, 1));

  const chip = (label: string, on: boolean, onPress: () => void, wide = false) => (
    <Pressable
      key={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: wide ? 54 : 42,
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: 10,
        alignItems: 'center',
        backgroundColor: on ? t.colors.accentSoft : 'transparent',
        borderWidth: 1,
        borderColor: on ? t.colors.accent : t.colors.line,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <RNText style={tx('600', 13, on ? t.colors.ink : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={onCancel} />
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: 24,
            maxHeight: '86%',
          }}
        >
          <View style={{ paddingTop: 12, alignItems: 'center' }}>
            <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: t.colors.line }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>Complete by</RNText>

            {/* Month navigation */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 18,
              }}
            >
              <Pressable onPress={() => shiftMonth(-1)} hitSlop={12}>
                <RNText style={tx('700', 20, t.colors.ink)}>‹</RNText>
              </Pressable>
              <RNText style={tx('700', 15, t.colors.ink)}>
                {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
              </RNText>
              <Pressable onPress={() => shiftMonth(1)} hitSlop={12}>
                <RNText style={tx('700', 20, t.colors.ink)}>›</RNText>
              </Pressable>
            </View>

            {/* Weekday header */}
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

            {/* Day grid */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {grid.map((day, i) => {
                if (!day) return <View key={`x${i}`} style={{ width: `${100 / 7}%`, height: 42 }} />;
                const isPast = day < today;
                const isSel = day.getTime() === picked.getTime();
                const isToday = day.getTime() === today.getTime();
                return (
                  <View key={day.toISOString()} style={{ width: `${100 / 7}%`, height: 42, padding: 3 }}>
                    <Pressable
                      disabled={isPast}
                      onPress={() => setPicked(day)}
                      style={{
                        flex: 1,
                        borderRadius: 999,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: isSel ? t.colors.accent : 'transparent',
                        borderWidth: !isSel && isToday ? 1 : 0,
                        borderColor: t.colors.accent,
                        opacity: isPast ? 0.28 : 1,
                      }}
                    >
                      <RNText
                        style={tx('600', 14, isSel ? t.colors.onAccent : t.colors.ink)}
                      >
                        {day.getDate()}
                      </RNText>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            {/* Clock */}
            <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 18 })}>
              TIME
            </RNText>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <RNText style={tx('800', 30, t.colors.ink, { letterSpacing: -0.6 })}>
                {hour}:{String(minute).padStart(2, '0')}
              </RNText>
              <View style={{ flexDirection: 'row', gap: 8, marginLeft: 'auto' }}>
                {chip('AM', !pm, () => setPm(false))}
                {chip('PM', pm, () => setPm(true))}
              </View>
            </View>

            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 14 })}>Hour</RNText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {HOURS.map((h) => chip(String(h), h === hour, () => setHour(h)))}
              </View>
            </ScrollView>

            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 14 })}>Minute</RNText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {MINUTES.map((m) =>
                  chip(String(m).padStart(2, '0'), m === minute, () => setMinute(m)),
                )}
              </View>
            </ScrollView>

            <View
              style={{
                marginTop: 18,
                padding: 13,
                borderRadius: 12,
                backgroundColor: t.colors.accentSoft,
                borderWidth: 1,
                borderColor: t.colors.accentBorder,
              }}
            >
              <RNText style={tx('600', 13, t.colors.accentDeep)}>{formatDeadline(result)}</RNText>
            </View>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 14 }}>
            <Pressable
              onPress={onCancel}
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
              onPress={() => onConfirm(result)}
              style={{
                flex: 2,
                borderRadius: 999,
                paddingVertical: 15,
                alignItems: 'center',
                backgroundColor: t.colors.accent,
              }}
            >
              <RNText style={tx('700', 15, t.colors.onAccent)}>Set deadline</RNText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
