import React from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
  ScrollView,
  FlatList,
  RefreshControl,
  type ListRenderItem,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { fontFamilyFor, type Theme } from '../theme';
import { useLayout } from '../lib/layout';
import { NativeHeaderCtx } from '../navigation/nativeHeader';

/** Animatable Pressable so a press can drive a native-thread scale/opacity
 *  tween directly on the touchable's own style, instead of the instant
 *  on/off `pressed` swap. Shared by Button and Chip below. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A small, snappy press-in/press-out scale — the one bit of shared motion
 *  every tappable control in the app gets for free. */
function usePressScale(to = 0.96) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  return { scale, onPressIn, onPressOut };
}

/** Which edges Screen pads for the status bar: none under a system header, which already clears it. */
function useTopEdge(): ['top'] | [] {
  return React.useContext(NativeHeaderCtx) ? [] : ['top'];
}

/** Full-screen container with themed background + safe area. */
export function Screen({
  children,
  scroll = false,
  padded = true,
  style,
  onRefresh,
  refreshing = false,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Pull-to-refresh handler. Only has an effect together with `scroll`. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const t = useTheme();
  const topEdge = useTopEdge();
  const inner: StyleProp<ViewStyle> = [
    { flex: 1, backgroundColor: t.colors.bg },
    padded && { paddingHorizontal: t.spacing.gutter },
    style,
  ];
  if (scroll) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.bg }} edges={topEdge}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            padded && { paddingHorizontal: t.spacing.gutter },
            { paddingBottom: t.spacing.xxl },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={t.colors.accent}
                colors={[t.colors.accent]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={inner} edges={topEdge}>
      {children}
    </SafeAreaView>
  );
}

/**
 * A full-screen feed that only draws the cards near the viewport. Same frame as
 * `<Screen scroll>` (safe area, pull-to-refresh, hidden scroll bar), with the
 * header above the cards, an empty state, and a footer. Cards sit one to a row
 * on a phone and two or three on a desktop browser, like `Grid`.
 */
export function ScreenList<T>({
  data,
  keyExtractor,
  renderItem,
  above,
  header,
  empty,
  footer,
  onRefresh,
  refreshing = false,
  tint,
  gap = 14,
  children,
}: {
  data: readonly T[];
  keyExtractor: (item: T) => string;
  renderItem: (info: Parameters<ListRenderItem<T>>[0]) => React.ReactElement | null;
  /** Pinned above the list, outside the scroll. */
  above?: React.ReactNode;
  header?: React.ReactElement | null;
  empty?: React.ReactElement | null;
  footer?: React.ReactElement | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Colour of the pull-to-refresh spinner; the accent by default. */
  tint?: string;
  gap?: number;
  /** Drawn after the list: sheets and other overlays. */
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const { columns } = useLayout();
  const topEdge = useTopEdge();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.bg }} edges={topEdge}>
      {above}
      <FlatList
        // FlatList cannot change its column count in place.
        key={columns}
        data={data}
        keyExtractor={keyExtractor}
        // Each card gets the page gutter and an equal share of the row, so a
        // short last row does not stretch its card across the whole width.
        renderItem={(info) => (
          <View style={{ width: `${100 / columns}%`, paddingHorizontal: columns > 1 ? gap / 2 : 20 }}>
            {renderItem(info)}
          </View>
        )}
        numColumns={columns}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: t.spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={7}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={tint ?? t.colors.accent}
              colors={[tint ?? t.colors.accent]}
            />
          ) : undefined
        }
        // Cards bring their own top margin.
        columnWrapperStyle={columns > 1 ? { paddingHorizontal: 20 - gap / 2 } : undefined}
      />
      {children}
    </SafeAreaView>
  );
}

type TextVariant = keyof Theme['typography'];
export function Text({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  variant?: TextVariant;
  color?: keyof Theme['colors'];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();
  const base = t.typography[variant];
  const defaultColor: keyof Theme['colors'] =
    variant === 'display' || variant.startsWith('h') ? 'ink' : 'text';
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[
        base as TextStyle,
        { fontFamily: fontFamilyFor(base.fontWeight), color: t.colors[color ?? defaultColor] },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

/**
 * The v2 card surface: white on the warm ground with a 1px line and a soft
 * drop shadow in light; border only in dark, where shadows read as smudges.
 */
export function cardSurface(t: Theme, radius: number = t.radius.lg): ViewStyle {
  return {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.line,
    borderWidth: 1,
    borderRadius: radius,
    shadowColor: t.colors.shadow,
    shadowOpacity: t.isDark ? 0 : 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: t.isDark ? 0 : 1,
  };
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const t = useTheme();
  const s: StyleProp<ViewStyle> = [cardSurface(t), { padding: t.spacing.lg }];
  if (onPress) {
    return <PressableCard baseStyle={s} onPress={onPress} style={style}>{children}</PressableCard>;
  }
  return <View style={[s, style]}>{children}</View>;
}

function PressableCard({
  children,
  baseStyle,
  onPress,
  style,
}: {
  children: React.ReactNode;
  baseStyle: StyleProp<ViewStyle>;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.98);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      style={[baseStyle, { transform: [{ scale }] }, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  // v2 buttons: 52 tall, pill, 15/700. Primary sits on the deep shade so
  // white text keeps 4.5:1; secondary is the soft accent tint.
  const bg =
    variant === 'primary'
      ? t.colors.btn
      : variant === 'danger'
        ? t.colors.signalDeep
        : variant === 'secondary'
          ? t.colors.accentSoft
          : 'transparent';
  const fg =
    variant === 'primary'
      ? t.colors.onBtn
      : variant === 'danger'
        ? t.isDark
          ? '#1A0C06'
          : '#FFFFFF'
        : variant === 'secondary'
          ? t.colors.accentDeep
          : t.colors.ink;
  const off = Boolean(disabled) && variant === 'primary';
  const { scale, onPressIn, onPressOut } = usePressScale(t.motion.pressScale);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={[
        {
          backgroundColor: off ? t.colors.surface2 : bg,
          borderRadius: t.radius.pill,
          minHeight: 52,
          paddingVertical: 14,
          paddingHorizontal: 22,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: variant === 'ghost' ? 1.5 : 0,
          borderColor: t.colors.line,
          opacity: disabled && !off ? 0.5 : 1,
          shadowColor: t.colors.btn,
          shadowOpacity: variant === 'primary' && !off && !t.isDark ? 0.3 : 0,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          transform: [{ scale }],
        },
        style,
      ]}
    >
      <RNText style={{ color: off ? t.colors.muted : fg, fontSize: 15, fontFamily: fontFamilyFor('700') }}>{label}</RNText>
    </AnimatedPressable>
  );
}

/** Small rounded chip/pill used for filters, flags, tags. */
export function Chip({
  label,
  active,
  tone = 'accent',
  onPress,
}: {
  label: string;
  active?: boolean;
  tone?: 'accent' | 'gold' | 'signal' | 'neutral';
  onPress?: () => void;
}) {
  const t = useTheme();
  // v2 chip: an outlined pill; selected takes the tone's border and soft
  // fill. "neutral" selected is the inked pill the filter rows use.
  const toneColor = tone === 'gold' ? t.colors.gold : tone === 'signal' ? t.colors.signal : t.colors.accent;
  const toneSoft = tone === 'gold' ? t.colors.goldSoft : tone === 'signal' ? t.colors.signalSoft : t.colors.accentSoft;
  const toneInk = tone === 'gold' ? t.colors.goldInk : tone === 'signal' ? t.colors.signalDeep : t.colors.accentDeep;
  const bg = active ? (tone === 'neutral' ? t.colors.ink : toneSoft) : t.colors.surface;
  const fg = active ? (tone === 'neutral' ? t.colors.bg : toneInk) : t.colors.text;
  const border = active ? (tone === 'neutral' ? t.colors.ink : toneColor) : t.colors.line;
  const { scale, onPressIn, onPressOut } = usePressScale(0.94);
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      style={{
        backgroundColor: bg,
        borderRadius: t.radius.pill,
        paddingVertical: 8,
        paddingHorizontal: 13,
        borderWidth: 1.5,
        borderColor: border,
        transform: [{ scale }],
      }}
    >
      <RNText style={{ color: fg, fontSize: 13, fontFamily: fontFamilyFor(active ? '700' : '600') }}>{label}</RNText>
    </AnimatedPressable>
  );
}

export function Avatar({ name, size = 40, online }: { name: string; size?: number; online?: boolean }) {
  const t = useTheme();
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <RNText style={{ color: t.colors.accentDeep, fontFamily: fontFamilyFor('800'), fontSize: size * 0.36 }}>
        {initials}
      </RNText>
      {online ? (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(10, Math.round(size * 0.28)),
            height: Math.max(10, Math.round(size * 0.28)),
            borderRadius: 999,
            backgroundColor: t.colors.online,
            borderWidth: 2,
            borderColor: t.colors.surface,
          }}
        />
      ) : null}
    </View>
  );
}

export function Row({
  children,
  gap = 8,
  align = 'center',
  justify = 'flex-start',
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap }, style]}
    >
      {children}
    </View>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.colors.line }} />;
}

/** Format minor units (paise) as ₹ currency. */
export function formatINR(minor: number): string {
  return '₹' + (minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
