import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  ScrollView,
  Modal,
  Animated,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  PanResponder,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Pressy, tx } from './primitives';
import { useLayout } from '../lib/layout';

/**
 * The shared building blocks of the second-wave screens (explore, AI posting,
 * my tasks, settings, help...). They are the same shapes the original screens
 * draw by hand -- 14px cards on a hairline, 999 pills, the 12px field -- pulled
 * into one place so thirty new views do not each re-type them.
 */

/** A modal sheet that rises from the bottom, like DateTimeSheet's. */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxHeight = '88%',
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxHeight?: `${number}%`;
}) {
  const t = useTheme();
  const { desktop } = useLayout();
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
  // A phone sheet rises from the bottom edge; on desktop it is a centred
  // dialog that settles in from just below.
  const sheetY = rise.interpolate({ inputRange: [0, 1], outputRange: [desktop ? 40 : 420, 0] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
      >
        <Animated.View
          style={{
            flex: 1,
            justifyContent: desktop ? 'center' : 'flex-end',
            alignItems: desktop ? 'center' : 'stretch',
            backgroundColor: 'rgba(0,0,0,0.45)',
            opacity: rise,
          }}
        >
          <Pressable
            style={desktop ? { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } : { flex: 1 }}
            onPress={onClose}
            accessibilityLabel="Close"
          />
          <Animated.View
            style={{
              backgroundColor: t.colors.bg,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              ...(desktop ? { borderRadius: 24, width: 560, maxWidth: '92%' as const } : null),
              paddingBottom: 20,
              maxHeight,
              transform: [{ translateY: sheetY }],
            }}
          >
            <View style={{ paddingTop: 12, alignItems: 'center' }}>
              <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: t.colors.line }} />
            </View>
            {title ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 14 }}>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>{title}</RNText>
                  {subtitle ? (
                    <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4, lineHeight: 19 })}>{subtitle}</RNText>
                  ) : null}
                </View>
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                  <Icon name="close" size={20} color={t.colors.muted} />
                </Pressable>
              </View>
            ) : null}
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {footer ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>{footer}</View> : null}
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Tabs with a sliding underline, as on the orders screen. */
export function UnderlineTabs({
  tabs,
  active,
  onPick,
  inset = 20,
}: {
  tabs: string[];
  active: number;
  onPick: (i: number) => void;
  inset?: number;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const track = Math.max(0, width - inset * 2);
  const each = tabs.length ? track / tabs.length : 0;
  const left = useRef(new Animated.Value(inset)).current;
  useEffect(() => {
    const anim = Animated.timing(left, { toValue: inset + each * active, duration: 280, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [active, each, left, inset]);

  return (
    <View
      style={{ flexDirection: 'row', paddingHorizontal: inset }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {tabs.map((label, i) => {
        const on = active === i;
        return (
          <Pressable
            key={label}
            onPress={() => onPick(i)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}
          >
            <RNText style={tx(on ? '700' : '600', 13, on ? t.colors.ink : t.colors.muted)} numberOfLines={1}>
              {label}
            </RNText>
          </Pressable>
        );
      })}
      <View style={{ position: 'absolute', left: inset, right: inset, bottom: 0, height: 2, backgroundColor: t.colors.line }} />
      <Animated.View
        style={{ position: 'absolute', left, bottom: 0, height: 2, width: each, backgroundColor: t.colors.accent }}
      />
    </View>
  );
}

/**
 * A feed of cards: one column on a phone, two or three side by side on a
 * desktop browser. On a phone it renders its children untouched, so wrapping
 * a list in it changes nothing there.
 */
export function Grid({ children, gap = 14 }: { children: React.ReactNode; gap?: number }) {
  const { columns } = useLayout();
  if (columns === 1) return <>{children}</>;
  const items = React.Children.toArray(children);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {items.map((child, i) => (
        <View
          key={React.isValidElement(child) && child.key != null ? child.key : i}
          style={{ width: `${100 / columns}%`, paddingHorizontal: gap / 2 }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * Tabs as a row of pills with a count on each, scrolling sideways when they do
 * not fit. Unlike the underline tabs, a long label never gets squeezed into
 * "In progress (1)Complet…".
 */
export function PillTabs({
  tabs,
  active,
  onPick,
  inset = 20,
}: {
  tabs: { label: string; count?: number }[];
  active: number;
  onPick: (i: number) => void;
  inset?: number;
}) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: inset, gap: 8 }}
    >
      {tabs.map((tab, i) => {
        const on = i === active;
        return (
          <Pressable
            key={tab.label}
            onPress={() => onPick(i)}
            accessibilityRole="tab"
            accessibilityLabel={tab.count !== undefined ? `${tab.label}, ${tab.count}` : tab.label}
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingVertical: 9,
              paddingLeft: 15,
              paddingRight: tab.count !== undefined ? 9 : 15,
              borderRadius: 999,
              backgroundColor: on ? t.colors.ink : t.colors.surface,
              borderWidth: 1,
              borderColor: on ? t.colors.ink : t.colors.line,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <RNText style={tx('700', 13, on ? t.colors.bg : t.colors.ink)}>{tab.label}</RNText>
            {tab.count !== undefined ? (
              <View
                style={{
                  minWidth: 22,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: 999,
                  alignItems: 'center',
                  backgroundColor: on ? t.colors.accent : t.colors.surface2,
                }}
              >
                <RNText style={tx('800', 11, on ? t.colors.onAccent : t.colors.muted)}>{tab.count}</RNText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Swipe left or right to change tab, the way every native tab strip works.
 *
 * It wraps whatever the screen already renders for the active tab rather than
 * mounting every tab side by side, so a screen keeps its own tab logic and only
 * gains the gesture. Only a clearly sideways drag is taken: anything more
 * vertical than horizontal is left to the ScrollView inside.
 */
export function SwipeTabs({
  index,
  count,
  onChange,
  children,
  style,
}: {
  index: number;
  count: number;
  onChange: (next: number) => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const fade = x.interpolate({ inputRange: [-120, 0, 120], outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
  const state = useRef({ index, count, onChange });
  state.current = { index, count, onChange };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_e, g) => {
        const { index: i, count: n } = state.current;
        // Resist at the ends, so there is feedback without a page to go to.
        const atEdge = (g.dx > 0 && i === 0) || (g.dx < 0 && i === n - 1);
        x.setValue(g.dx * (atEdge ? 0.12 : 0.4));
      },
      onPanResponderRelease: (_e, g) => {
        const { index: i, count: n, onChange: change } = state.current;
        const dir = g.dx < -60 || g.vx < -0.5 ? 1 : g.dx > 60 || g.vx > 0.5 ? -1 : 0;
        const next = i + dir;
        if (dir === 0 || next < 0 || next >= n) {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
          return;
        }
        Animated.timing(x, { toValue: -dir * 120, duration: 110, useNativeDriver: true }).start(() => {
          change(next);
          x.setValue(dir * 120);
          Animated.spring(x, { toValue: 0, useNativeDriver: true, friction: 8, tension: 80 }).start();
        });
      },
      onPanResponderTerminate: () => {
        Animated.spring(x, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      },
    }),
  ).current;

  return (
    <Animated.View {...pan.panHandlers} style={[{ flex: 1, opacity: fade, transform: [{ translateX: x }] }, style]}>
      {children}
    </Animated.View>
  );
}

/**
 * "Are you sure?" -- for the taps that cannot be taken back (closing a task,
 * releasing money). A centred card rather than a sheet, so it reads as a
 * question that has to be answered, not a menu.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Go back',
  danger = false,
  busy = false,
  icon = 'shield',
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  icon?: IconName;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      pop.setValue(0);
      return;
    }
    const anim = Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 8, tension: 110 });
    anim.start();
    return () => anim.stop();
  }, [visible, pop]);
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const tone = danger ? t.colors.signal : t.colors.accent;
  const toneSoft = danger ? t.colors.signalSoft : t.colors.accentSoft;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <Animated.View
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 28, opacity: pop }}
      >
        <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} onPress={busy ? undefined : onCancel} />
        <Animated.View
          accessibilityRole="alert"
          style={{
            backgroundColor: t.colors.bg,
            borderRadius: 24,
            padding: 22,
            transform: [{ scale }],
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
            elevation: 12,
          }}
        >
          <View
            style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: toneSoft, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={icon} size={22} color={tone} strokeWidth={2} />
          </View>
          <RNText style={tx('800', 19, t.colors.ink, { marginTop: 14, letterSpacing: -0.3 })}>{title}</RNText>
          <RNText style={tx('400', 14, t.colors.text, { marginTop: 8, lineHeight: 21 })}>{message}</RNText>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 14,
                borderRadius: 999,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: t.colors.line,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <RNText style={tx('700', 14, t.colors.ink)}>{cancelLabel}</RNText>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flex: 1.3,
                paddingVertical: 14,
                borderRadius: 999,
                alignItems: 'center',
                backgroundColor: tone,
                opacity: busy ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              {busy ? (
                <ActivityIndicator color={t.colors.onAccent} />
              ) : (
                <RNText style={tx('800', 14, t.colors.onAccent)}>{confirmLabel}</RNText>
              )}
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/** Label-over-input field with the app's bordered box. */
export function Field({
  label,
  hint,
  error,
  style,
  left,
  right,
  minHeight = 84,
  ...input
}: TextInputProps & {
  /** Multiline only: the smallest the box gets. */
  minHeight?: number;
  label?: string;
  hint?: string;
  error?: string | null;
  style?: StyleProp<ViewStyle>;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  // Multiline boxes grow with their text, so the whole thing is always
  // visible instead of hiding behind a scrollbar inside the box.
  const [contentH, setContentH] = useState(0);
  return (
    <View style={style}>
      {label ? (
        <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3, marginBottom: 8 })}>
          {label.toUpperCase()}
        </RNText>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: input.multiline ? 'flex-start' : 'center',
          gap: 10,
          backgroundColor: t.colors.surface2,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: error ? t.colors.signal : focused ? t.colors.accent : t.colors.line,
          paddingVertical: input.multiline ? 12 : 13,
          paddingHorizontal: 14,
        }}
      >
        {left}
        <TextInput
          placeholderTextColor={t.colors.muted}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          onContentSizeChange={(e) => {
            if (input.multiline) setContentH(e.nativeEvent.contentSize.height);
            input.onContentSizeChange?.(e);
          }}
          style={[
            tx('400', 15, t.colors.ink, { flex: 1, padding: 0 }),
            input.multiline
              ? { minHeight, height: Math.max(minHeight, Math.ceil(contentH)), textAlignVertical: 'top' }
              : null,
          ]}
        />
        {right}
      </View>
      {error ? (
        <RNText style={tx('500', 12, t.colors.signalDeep, { marginTop: 6 })}>{error}</RNText>
      ) : hint ? (
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6, lineHeight: 17 })}>{hint}</RNText>
      ) : null}
    </View>
  );
}

/** Section heading with an optional "See all" action on the right. */
export function SectionTitle({
  title,
  icon,
  action,
  onAction,
  style,
  badge,
}: {
  title: string;
  icon?: IconName;
  action?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
  badge?: string;
}) {
  const t = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>
      {icon ? <Icon name={icon} size={17} color={t.colors.accentDeep} strokeWidth={1.9} /> : null}
      <RNText style={tx('800', 17, t.colors.ink, { letterSpacing: -0.34, flexShrink: 1 })}>{title}</RNText>
      {badge ? <Badge label={badge} tone="gold" /> : null}
      <View style={{ flex: 1 }} />
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{action} ›</RNText>
        </Pressable>
      ) : null}
    </View>
  );
}

export type Tone = 'accent' | 'gold' | 'signal' | 'blue' | 'purple' | 'neutral';

export function toneColors(t: ReturnType<typeof useTheme>, tone: Tone) {
  switch (tone) {
    case 'gold':
      return { fg: t.colors.goldInk, bg: t.colors.goldSoft };
    case 'signal':
      return { fg: t.colors.signalDeep, bg: t.colors.signalSoft };
    case 'blue':
      return { fg: t.colors.blue, bg: t.colors.surface2 };
    case 'purple':
      return { fg: t.colors.purpleDeep, bg: t.colors.surface2 };
    case 'neutral':
      return { fg: t.colors.muted, bg: t.colors.surface2 };
    default:
      return { fg: t.colors.accentDeep, bg: t.colors.accentSoft };
  }
}

/** A small status label. */
export function Badge({ label, tone = 'accent' }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <RNText style={tx('700', 10, c.fg, { letterSpacing: 0.6 })}>{label.toUpperCase()}</RNText>
    </View>
  );
}

/** One figure with a label, for the stats rows. */
export function StatTile({
  icon,
  label,
  value,
  tone = 'accent',
  style,
}: {
  icon: IconName;
  label: string;
  value: string;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: 140,
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.line,
          borderRadius: 14,
          padding: 13,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 26, height: 26, borderRadius: 8, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={15} color={c.fg} strokeWidth={2} />
        </View>
        <RNText style={tx('600', 12, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
          {label}
        </RNText>
      </View>
      <RNText style={tx('800', 20, t.colors.ink, { marginTop: 9, letterSpacing: -0.4 })}>{value}</RNText>
    </View>
  );
}

/** An outlined filter pill; filled when active. */
export function Pill({
  label,
  active,
  onPress,
  icon,
  count,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: IconName;
  count?: number;
}) {
  const t = useTheme();
  return (
    <Pressy
      onPress={onPress}
      label={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: active ? t.colors.accentSoft : t.colors.surface,
        borderWidth: 1,
        borderColor: active ? t.colors.accent : t.colors.line,
        borderRadius: 999,
        paddingVertical: 7,
        paddingHorizontal: 12,
      }}
    >
      {icon ? <Icon name={icon} size={13} color={active ? t.colors.accentDeep : t.colors.muted} strokeWidth={2} /> : null}
      <RNText style={tx('600', 12, active ? t.colors.accentDeep : t.colors.text)} numberOfLines={1}>
        {label}
        {typeof count === 'number' ? ` (${count})` : ''}
      </RNText>
    </Pressy>
  );
}

/** The one filled call to action at the bottom of a form. */
export function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
  tone = 'accent',
  style,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'accent' | 'signal' | 'quiet';
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const off = disabled || busy;
  const bg = tone === 'signal' ? t.colors.signal : tone === 'quiet' ? t.colors.surface2 : t.colors.accent;
  const fg = tone === 'quiet' ? t.colors.ink : t.colors.onAccent;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(off) }}
      style={({ pressed }) => [
        {
          borderRadius: 12,
          paddingVertical: 15,
          alignItems: 'center',
          backgroundColor: disabled ? t.colors.surface2 : bg,
          borderWidth: tone === 'quiet' ? 1 : 0,
          borderColor: t.colors.line,
          transform: [{ scale: pressed && !off ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={disabled ? t.colors.muted : fg} />
      ) : (
        <RNText style={tx('700', 15, disabled ? t.colors.muted : fg)}>{label}</RNText>
      )}
    </Pressable>
  );
}

/** Back arrow + title row for pushed (non-tab) screens. */
export function TopBar({
  title,
  onBack,
  right,
  subtitle,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  subtitle?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
      <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
        <Icon name="back" size={22} color={t.colors.ink} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.5 })} numberOfLines={1}>
          {title}
        </RNText>
        {subtitle ? (
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
            {subtitle}
          </RNText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Centered illustration-free empty state. */
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  style,
}: {
  icon: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 }, style]}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 999,
          backgroundColor: t.colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={28} color={t.colors.accentDeep} strokeWidth={1.7} />
      </View>
      <RNText style={tx('800', 16, t.colors.ink, { marginTop: 14, textAlign: 'center' })}>{title}</RNText>
      {body ? (
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19, textAlign: 'center' })}>{body}</RNText>
      ) : null}
      {actionLabel && onAction ? (
        <Pressy
          onPress={onAction}
          style={{ marginTop: 16, backgroundColor: t.colors.accent, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 18 }}
        >
          <RNText style={tx('700', 13, t.colors.onAccent)}>{actionLabel}</RNText>
        </Pressy>
      ) : null}
    </View>
  );
}

/** A pulsing placeholder block while something loads. */
export function Shimmer({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 575, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 575, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ height, borderRadius: 12, backgroundColor: t.colors.surface2, opacity }, style]} />;
}

/** A tappable settings/menu row. */
export function MenuRow({
  icon,
  label,
  sub,
  onPress,
  right,
  danger,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  onPress: () => void;
  right?: React.ReactNode;
  danger?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 13,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.line,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: danger ? t.colors.signalSoft : t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={danger ? t.colors.signal : t.colors.ink} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <RNText style={tx('600', 15, danger ? t.colors.signal : t.colors.ink)}>{label}</RNText>
        {sub ? <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>{sub}</RNText> : null}
      </View>
      {right ?? <Icon name="chevronRight" size={16} color={t.colors.muted} />}
    </Pressable>
  );
}

/** Small "₹1,234" in Indian grouping from whole rupees. */
export function rupees(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** "3m ago" / "5h ago" / "2d ago" / "12 Sep". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** "23h left" / "2d left" / "overdue" for a due time. */
export function timeLeft(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'overdue';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m left`;
  if (h < 48) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}
