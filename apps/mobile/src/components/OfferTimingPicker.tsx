import { View, Text as RNText, Pressable, TextInput, Platform } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { formatDeadline } from './DateTimeSheet';
import { Icon } from './Icon';
import { tx } from './primitives';
import { maskContacts } from '../lib/mask';
import { HOUR_STEPS, REASON_MAX, hoursText, stepHours, type OfferTiming, type TimingMode } from '../lib/offerTiming';

/**
 * "When can you finish it?" on an offer (plan 1.19 J, owner note 26 Nov).
 * No-date task: "By a date" or "In hours". Dated task: "That works" or "Ask for more time".
 * The date itself is picked in a DateTimeSheet the parent owns (`onPickDate`).
 */
export function OfferTimingPicker({
  noDate,
  taskDueAt,
  value,
  onChange,
  onPickDate,
  editable = true,
  label = 'When can you finish it?',
  caps = false,
}: {
  noDate: boolean;
  taskDueAt: string | null;
  value: OfferTiming;
  onChange: (next: OfferTiming) => void;
  onPickDate: () => void;
  editable?: boolean;
  label?: string;
  /** The task page's small uppercase section heading. */
  caps?: boolean;
}) {
  const t = useTheme();
  const set = (patch: Partial<OfferTiming>) => editable && onChange({ ...value, ...patch });
  const modes: [TimingMode, string][] = noDate
    ? [
        ['date', 'By a date'],
        ['hours', 'In hours'],
      ]
    : [
        ['keep', 'That works'],
        ['more', 'Ask for more time'],
      ];
  const dated = value.mode === 'date' || value.mode === 'more';
  const atMin = value.hours <= HOUR_STEPS[0];
  const atMax = value.hours >= HOUR_STEPS[HOUR_STEPS.length - 1];

  const stepBtn = (dir: 1 | -1, off: boolean) => (
    <Pressable
      onPress={() => !off && set({ hours: stepHours(value.hours, dir) })}
      disabled={off || !editable}
      accessibilityRole="button"
      accessibilityLabel={dir === 1 ? 'More hours' : 'Fewer hours'}
      hitSlop={6}
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: t.colors.line,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: off ? 0.4 : 1,
      }}
    >
      <Icon name={dir === 1 ? 'plus' : 'minus'} size={16} color={t.colors.ink} strokeWidth={2.2} />
    </Pressable>
  );

  return (
    <View>
      {caps ? (
        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>{label.toUpperCase()}</RNText>
      ) : (
        <RNText style={tx('700', 14, t.colors.ink)}>{label}</RNText>
      )}
      {noDate ? (
        <RNText style={tx('500', 12, t.colors.muted, { marginTop: 4, lineHeight: 17 })}>
          This task has no fixed date. Tell the customer when you can finish: a date becomes the task’s date if they choose you.
        </RNText>
      ) : taskDueAt ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          <RNText style={tx('500', 12.5, t.colors.muted)}>Customer’s date</RNText>
          <RNText style={tx('700', 12.5, t.colors.ink)}>{formatDeadline(new Date(taskDueAt))}</RNText>
        </View>
      ) : null}

      <View
        accessibilityRole="radiogroup"
        style={{ flexDirection: 'row', gap: 3, padding: 3, marginTop: 10, borderRadius: 12, backgroundColor: t.colors.surface2 }}
      >
        {modes.map(([mode, text]) => {
          const on = value.mode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => set({ mode })}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !editable }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 8,
                borderRadius: 9,
                backgroundColor: on ? t.colors.surface : 'transparent',
                ...(on ? { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null),
              }}
            >
              <RNText style={tx('700', 12.5, on ? t.colors.accentDeep : t.colors.muted)}>{text}</RNText>
            </Pressable>
          );
        })}
      </View>

      {dated ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <Pressable
            onPress={() => editable && onPickDate()}
            accessibilityRole="button"
            accessibilityLabel={
              value.finishBy ? `Finish by ${formatDeadline(value.finishBy)}. Change it` : value.mode === 'more' ? 'Pick the date you can finish by' : 'When can you finish it?'
            }
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              borderWidth: 1.5,
              borderColor: value.finishBy ? t.colors.accent : t.colors.line,
              backgroundColor: value.finishBy ? t.colors.accentSoft : t.colors.surface,
              borderRadius: 12,
              paddingVertical: 11,
              paddingHorizontal: 12,
            }}
          >
            <Icon name="clock" size={15} color={value.finishBy ? t.colors.accentDeep : t.colors.muted} strokeWidth={1.9} />
            <RNText style={tx(value.finishBy ? '700' : '500', 13.5, value.finishBy ? t.colors.accentDeep : t.colors.muted, { flex: 1 })} numberOfLines={1}>
              {value.finishBy
                ? `${value.mode === 'more' ? 'I can finish by' : 'Finish by'} ${formatDeadline(value.finishBy)}`
                : value.mode === 'more'
                  ? 'I can finish by…'
                  : 'Finish by (optional)'}
            </RNText>
          </Pressable>
          {value.finishBy ? (
            <Pressable onPress={() => set({ finishBy: null })} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear the finish date">
              <Icon name="close" size={16} color={t.colors.muted} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {value.mode === 'hours' ? (
        <>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 10,
              borderWidth: 1.5,
              borderColor: t.colors.accent,
              borderRadius: 14,
              paddingVertical: 8,
              paddingHorizontal: 10,
            }}
          >
            {stepBtn(-1, atMin)}
            <RNText accessibilityLiveRegion="polite" style={tx('800', 17, t.colors.ink, { fontVariant: ['tabular-nums'] })}>
              {hoursText(value.hours)}
            </RNText>
            {stepBtn(1, atMax)}
          </View>
          <RNText style={tx('500', 12, t.colors.muted, { marginTop: 6 })}>Counted from when you start the work.</RNText>
        </>
      ) : null}

      {value.mode === 'more' ? (
        <View style={{ marginTop: 10, borderWidth: 1.5, borderColor: t.colors.line, backgroundColor: t.colors.surface, borderRadius: 12, padding: 11 }}>
          <TextInput
            value={value.reason}
            onChangeText={(v) => set({ reason: maskContacts(v).text.slice(0, REASON_MAX) })}
            editable={editable}
            multiline
            maxLength={REASON_MAX}
            placeholder="Why (optional): e.g. the paint needs a day to dry"
            placeholderTextColor={t.colors.muted}
            accessibilityLabel="Why you need more time (optional)"
            style={tx('400', 13.5, t.colors.ink, {
              minHeight: 44,
              padding: 0,
              textAlignVertical: 'top',
              lineHeight: 19,
              ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
            })}
          />
        </View>
      ) : null}
    </View>
  );
}
