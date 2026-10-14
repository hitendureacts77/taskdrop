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
  Platform,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon, type IconName } from './Icon';
import { Pressy, tx } from './primitives';
import { useLayout } from '../lib/layout';
import { LOOP_NATIVE, useReducedMotion } from '../lib/motion';

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
  const { desktop, tablet } = useLayout();
  const dialog = desktop || tablet;
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      rise.setValue(0);
      return;
    }
    // Phone: a spring rise from the bottom edge (SYS-Motion "sheet", 380 ms).
    // Wider screens: a centred dialog that scales and fades in.
    const anim = dialog
      ? Animated.timing(rise, { toValue: 1, duration: 260, useNativeDriver: true })
      : Animated.spring(rise, { toValue: 1, useNativeDriver: true, friction: 10, tension: 68 });
    anim.start();
    return () => anim.stop();
  }, [visible, rise, dialog]);
  const sheetY = rise.interpolate({ inputRange: [0, 1], outputRange: [dialog ? 12 : 520, 0] });
  const sheetScale = rise.interpolate({ inputRange: [0, 1], outputRange: [dialog ? 0.94 : 1, 1] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
      >
        <Animated.View
          style={{
            flex: 1,
            justifyContent: dialog ? 'center' : 'flex-end',
            alignItems: dialog ? 'center' : 'stretch',
            backgroundColor: 'rgba(8,10,12,0.5)',
            opacity: rise,
          }}
        >
          <Pressable
            style={dialog ? { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } : { flex: 1 }}
            onPress={onClose}
            accessibilityLabel="Close"
          />
          <Animated.View
            style={{
              backgroundColor: t.colors.bg,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              ...(dialog ? { borderRadius: 28, width: 560, maxWidth: '92%' as const } : null),
              paddingBottom: 20,
              maxHeight,
              shadowColor: '#000',
              shadowOpacity: 0.25,
              shadowRadius: 30,
              shadowOffset: { width: 0, height: -6 },
              elevation: 16,
              transform: [{ translateY: sheetY }, { scale: sheetScale }],
            }}
          >
            {dialog ? (
              <View style={{ height: 10 }} />
            ) : (
              <View style={{ paddingTop: 12, alignItems: 'center' }}>
                <View style={{ width: 40, height: 4, borderRadius: 999, backgroundColor: t.colors.line }} />
              </View>
            )}
            {title ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingTop: 14 }}>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('800', 21, t.colors.ink, { letterSpacing: -0.5 })}>{title}</RNText>
                  {subtitle ? (
                    <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4, lineHeight: 19 })}>{subtitle}</RNText>
                  ) : null}
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={({ pressed }) => ({
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    backgroundColor: t.colors.surface2,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: [{ scale: pressed ? 0.92 : 1 }],
                  })}
                >
                  <Icon name="close" size={17} color={t.colors.text} />
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

/**
 * Tabs with a sliding underline (v2): left-aligned labels at their own width,
 * 24 apart, and a 2.5px accent bar that glides to the one chosen.
 */
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
  const [spots, setSpots] = useState<{ x: number; w: number }[]>([]);
  const left = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    const spot = spots[active];
    if (!spot) return;
    if (!placed.current) {
      // First layout: put the bar in place without a slide.
      left.setValue(spot.x);
      width.setValue(spot.w);
      placed.current = true;
      return;
    }
    const anim = Animated.parallel([
      Animated.timing(left, { toValue: spot.x, duration: 280, useNativeDriver: false }),
      Animated.timing(width, { toValue: spot.w, duration: 280, useNativeDriver: false }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [active, spots, left, width]);

  return (
    <View style={{ marginHorizontal: inset }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ flexDirection: 'row', gap: 24, flexGrow: 1 }}>
          {tabs.map((label, i) => {
            const on = active === i;
            return (
              <Pressable
                key={label}
                onPress={() => onPick(i)}
                onLayout={(e) => {
                  const { x, width: w } = e.nativeEvent.layout;
                  setSpots((cur) => {
                    if (cur[i]?.x === x && cur[i]?.w === w) return cur;
                    const next = [...cur];
                    next[i] = { x, w };
                    return next;
                  });
                }}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected: on }}
                style={{ paddingVertical: 12 }}
              >
                <RNText style={tx(on ? '800' : '600', 14, on ? t.colors.ink : t.colors.muted)} numberOfLines={1}>
                  {label}
                </RNText>
              </Pressable>
            );
          })}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: t.colors.line }} />
          <Animated.View
            pointerEvents="none"
            style={{ position: 'absolute', left, bottom: 0, height: 2.5, borderRadius: 3, width, backgroundColor: t.colors.accent }}
          />
        </View>
      </ScrollView>
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
  // Design from 21st.dev "Segmented Control Tabs" (cnippet-dev): a quiet track
  // with the chosen tab lifted onto it as a raised white pill.
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: inset }}
    >
      <View style={{ flexDirection: 'row', gap: 2, padding: 3, borderRadius: 999, backgroundColor: t.colors.surface2 }}>
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
                paddingVertical: 8,
                paddingLeft: 15,
                paddingRight: tab.count !== undefined ? 9 : 15,
                borderRadius: 999,
                backgroundColor: on ? (t.isDark ? t.colors.line : t.colors.surface) : 'transparent',
                shadowColor: t.colors.shadow,
                shadowOpacity: on && !t.isDark ? 0.12 : 0,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
                elevation: on && !t.isDark ? 1 : 0,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              })}
            >
              <RNText style={tx(on ? '800' : '600', 13, on ? t.colors.ink : t.colors.muted)}>{tab.label}</RNText>
              {tab.count !== undefined ? (
                <View
                  style={{
                    minWidth: 22,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    borderRadius: 999,
                    alignItems: 'center',
                    backgroundColor: on ? t.colors.accentSoft : 'transparent',
                  }}
                >
                  <RNText style={tx('800', 11, on ? t.colors.accentDeep : t.colors.muted)}>{tab.count}</RNText>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
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
  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const tone = danger ? t.colors.signalDeep : t.colors.btn;
  const toneIcon = danger ? t.colors.signal : t.colors.accent;
  const onTone = danger ? (t.isDark ? '#1A0C06' : '#FFFFFF') : t.colors.onBtn;
  const toneSoft = danger ? t.colors.signalSoft : t.colors.accentSoft;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
      <Animated.View
        style={{ flex: 1, backgroundColor: 'rgba(8,10,12,0.5)', justifyContent: 'center', alignItems: 'center', padding: 28, opacity: pop }}
      >
        <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} onPress={busy ? undefined : onCancel} />
        <Animated.View
          accessibilityRole="alert"
          style={{
            backgroundColor: t.colors.bg,
            borderRadius: 26,
            padding: 22,
            width: '100%',
            maxWidth: 440,
            transform: [{ scale }],
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
            elevation: 12,
          }}
        >
          <View
            style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: toneSoft, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={icon} size={24} color={toneIcon} strokeWidth={2} />
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
                minHeight: 50,
                paddingVertical: 14,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
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
                minHeight: 50,
                paddingVertical: 14,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: tone,
                opacity: busy ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              {busy ? (
                <ActivityIndicator color={onTone} />
              ) : (
                <RNText style={tx('800', 14, onTone)}>{confirmLabel}</RNText>
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
  const inputRef = useRef<TextInput>(null);
  // v2 field: the label sits inside the box, over the value; tapping
  // anywhere in the box puts the cursor in the input.
  return (
    <View style={style}>
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessible={false}
        style={{
          backgroundColor: t.colors.surface,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: error ? t.colors.signal : focused ? t.colors.accent : t.colors.line,
          paddingVertical: label ? 11 : input.multiline ? 12 : 13,
          paddingHorizontal: 14,
          // The v2 focus ring (web): a soft halo of the accent around the box.
          ...(Platform.OS === 'web' && (focused || error)
            ? ({ boxShadow: `0 0 0 4px ${error ? t.colors.signalSoft : t.colors.accentSoft}` } as object)
            : null),
        }}
      >
        {label ? (
          <RNText style={tx('700', 11, focused ? t.colors.accentDeep : t.colors.muted, { letterSpacing: 1, marginBottom: 5 })}>
            {label.toUpperCase()}
          </RNText>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: input.multiline ? 'flex-start' : 'center', gap: 10 }}>
        {left}
        <TextInput
          ref={inputRef}
          accessibilityLabel={input.accessibilityLabel ?? label}
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
      </Pressable>
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
  // v2 section head: the icon sits on a small tinted tile, 18/800 title, and
  // the action is a plain accent link on the right.
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10 }, style]}>
      {icon ? (
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 10,
            backgroundColor: t.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={16} color={t.colors.accentDeep} strokeWidth={1.9} />
        </View>
      ) : null}
      <RNText style={tx('800', 18, t.colors.ink, { letterSpacing: -0.35, flexShrink: 1 })}>{title}</RNText>
      {badge ? <Badge label={badge} tone="signal" /> : null}
      <View style={{ flex: 1 }} />
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{action}</RNText>
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
      return { fg: t.isDark ? t.colors.blue : '#2A6CB8', bg: t.colors.purpleSoft };
    case 'purple':
      return { fg: t.isDark ? '#9DB4FF' : t.colors.purple, bg: t.colors.purpleSoft };
    case 'neutral':
      return { fg: t.colors.text, bg: t.colors.surface2 };
    default:
      return { fg: t.colors.accentDeep, bg: t.colors.accentSoft };
  }
}

/**
 * A dot in a soft halo. Design from 21st.dev "Status" (diceui): the halo only
 * pulses for states that are waiting on someone (gold, signal), and never
 * when the phone asks for reduced motion.
 */
function HaloDot({ color, pulse }: { color: string; pulse: boolean }) {
  const reduced = useReducedMotion();
  const beat = useRef(new Animated.Value(0)).current;
  const live = pulse && !reduced;
  useEffect(() => {
    if (!live) {
      beat.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(beat, { toValue: 1, duration: 2000, useNativeDriver: LOOP_NATIVE }));
    loop.start();
    return () => loop.stop();
  }, [live, beat]);
  return (
    <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      <Animated.View
        style={{
          position: 'absolute',
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: color,
          opacity: live ? beat.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0.32, 0, 0] }) : 0.16,
          transform: [{ scale: live ? beat.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] }) : 1 }],
        }}
      />
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

/** A small status label: says what is happening in words, not just colour. */
export function Badge({ label, tone = 'accent' }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const c = toneColors(t, tone);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: c.bg,
        borderWidth: 1,
        borderColor: `${c.fg}33`,
        borderRadius: 999,
        minHeight: 22,
        paddingLeft: 7,
        paddingRight: 9,
        paddingVertical: 2,
        alignSelf: 'flex-start',
      }}
    >
      <HaloDot color={c.fg} pulse={tone === 'gold' || tone === 'signal'} />
      <RNText style={tx('800', 10, c.fg, { letterSpacing: 0.5 })}>{label.toUpperCase()}</RNText>
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
          borderRadius: 18,
          padding: 14,
          shadowColor: t.colors.shadow,
          shadowOpacity: t.isDark ? 0 : 0.06,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={16} color={c.fg} strokeWidth={2} />
        </View>
        <RNText style={tx('600', 12, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
          {label}
        </RNText>
      </View>
      <RNText style={tx('800', 21, t.colors.ink, { marginTop: 10, letterSpacing: -0.5, fontVariant: ['tabular-nums'] })}>
        {value}
      </RNText>
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
      scaleTo={0.94}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: active ? t.colors.accentSoft : t.colors.surface,
        borderWidth: 1.5,
        borderColor: active ? t.colors.accent : t.colors.line,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 13,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={active ? t.colors.accentDeep : t.colors.muted} strokeWidth={2} /> : null}
      <RNText style={tx(active ? '700' : '600', 13, active ? t.colors.accentDeep : t.colors.text)} numberOfLines={1}>
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
  // v2: a 52-tall pill on the deep shade (white text 4.5:1+), lifted by a
  // soft shadow of its own colour in light.
  const bg = tone === 'signal' ? t.colors.signalDeep : tone === 'quiet' ? t.colors.surface : t.colors.btn;
  const fg = tone === 'quiet' ? t.colors.ink : tone === 'signal' ? (t.isDark ? '#1A0C06' : '#FFFFFF') : t.colors.onBtn;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(off) }}
      style={({ pressed }) => [
        {
          borderRadius: 999,
          minHeight: 52,
          paddingVertical: 15,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: disabled ? t.colors.surface2 : bg,
          borderWidth: tone === 'quiet' ? 1.5 : 0,
          borderColor: t.colors.line,
          shadowColor: bg,
          shadowOpacity: !disabled && tone !== 'quiet' && !t.isDark ? 0.32 : 0,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          transform: [{ scale: pressed && !off ? t.motion.pressScale : 1 }],
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

/** The 40×40 rounded-square icon button from the v2 header. */
export function IconButton({
  icon,
  label,
  onPress,
  badge,
  size = 40,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
  size?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      hitSlop={4}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        width: size,
        height: size,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: hovered ? t.colors.accentBorder : t.colors.line,
        backgroundColor: t.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Icon name={icon} size={20} color={t.colors.ink} strokeWidth={1.8} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: -5,
            right: -5,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 999,
            backgroundColor: t.colors.signalDeep,
            borderWidth: 2,
            borderColor: t.colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RNText style={tx('800', 9, '#FFFFFF')}>{badge > 9 ? '9+' : badge}</RNText>
        </View>
      ) : null}
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
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
      <IconButton icon="back" label="Back" onPress={onBack} />
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

/**
 * Empty state: a soft drop with a faint ripple behind the icon, the title and
 * one line of what to do next (SYS-Components "Nothing here yet").
 */
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
      <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            position: 'absolute',
            width: 96,
            height: 96,
            borderRadius: 999,
            borderWidth: 1.5,
            borderColor: t.colors.accentBorder,
            opacity: 0.6,
          }}
        />
        <View
          style={{
            width: 68,
            height: 68,
            borderRadius: 999,
            backgroundColor: t.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={28} color={t.colors.accentDeep} strokeWidth={1.7} />
        </View>
      </View>
      <RNText style={tx('800', 17, t.colors.ink, { marginTop: 14, textAlign: 'center', letterSpacing: -0.3 })}>{title}</RNText>
      {body ? (
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19, textAlign: 'center', maxWidth: 320 })}>{body}</RNText>
      ) : null}
      {actionLabel && onAction ? (
        <Pressy
          onPress={onAction}
          style={{ marginTop: 18, backgroundColor: t.colors.btn, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20 }}
        >
          <RNText style={tx('700', 14, t.colors.onBtn)}>{actionLabel}</RNText>
        </Pressy>
      ) : null}
    </View>
  );
}

/** A shimmering placeholder block while something loads. */
export function Shimmer({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const sweep = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1300, useNativeDriver: LOOP_NATIVE }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep, reduced]);
  const band = Math.max(80, w * 0.45);
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ height, borderRadius: 16, backgroundColor: t.colors.surface2, overflow: 'hidden' }, style]}
    >
      {w > 0 && !reduced ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: band,
            backgroundColor: t.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.65)',
            transform: [
              { translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-band, w + band] }) },
              { skewX: '-18deg' },
            ],
          }}
        />
      ) : null}
    </View>
  );
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
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 13,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.line,
        opacity: pressed ? 0.7 : 1,
        backgroundColor: hovered ? t.colors.surface2 : 'transparent',
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 11,
          backgroundColor: danger ? t.colors.signalSoft : t.colors.surface2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={danger ? t.colors.signalDeep : t.colors.ink} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <RNText style={tx('600', 15, danger ? t.colors.signalDeep : t.colors.ink)}>{label}</RNText>
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
