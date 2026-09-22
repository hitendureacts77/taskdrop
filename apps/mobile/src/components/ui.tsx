import React from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
  StyleSheet,
  ScrollView,
  RefreshControl,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { fontFamilyFor, type Theme } from '../theme';

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
  const inner: StyleProp<ViewStyle> = [
    { flex: 1, backgroundColor: t.colors.bg },
    padded && { paddingHorizontal: t.spacing.lg },
    style,
  ];
  if (scroll) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.bg }} edges={['top']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            padded && { paddingHorizontal: t.spacing.lg },
            { paddingBottom: t.spacing.xxl },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.accent} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={inner} edges={['top']}>
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
  const s: StyleProp<ViewStyle> = {
    backgroundColor: t.colors.surface,
    borderColor: t.colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: t.radius.lg,
    padding: t.spacing.lg,
  };
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
  const bg =
    variant === 'primary'
      ? t.colors.accent
      : variant === 'danger'
        ? t.colors.signal
        : variant === 'secondary'
          ? t.colors.surface2
          : 'transparent';
  const fg =
    variant === 'primary' || variant === 'danger'
      ? t.colors.onAccent
      : variant === 'secondary'
        ? t.colors.ink
        : t.colors.accent;
  const { scale, onPressIn, onPressOut } = usePressScale();
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
          backgroundColor: bg,
          borderRadius: t.radius.md,
          paddingVertical: 14,
          paddingHorizontal: t.spacing.lg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth : 0,
          borderColor: t.colors.accent,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale }],
        },
        style,
      ]}
    >
      <RNText style={{ color: fg, fontSize: 15, fontFamily: fontFamilyFor('700') }}>{label}</RNText>
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
  const toneColor =
    tone === 'gold' ? t.colors.gold : tone === 'signal' ? t.colors.signal : t.colors.accent;
  const bg = active
    ? tone === 'neutral'
      ? t.colors.ink
      : toneColor
    : t.colors.surface2;
  const fg = active ? t.colors.onAccent : t.colors.text;
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
        paddingVertical: 7,
        paddingHorizontal: 13,
        borderWidth: active ? 0 : StyleSheet.hairlineWidth,
        borderColor: t.colors.line,
        transform: [{ scale }],
      }}
    >
      <RNText style={{ color: fg, fontSize: 13, fontFamily: fontFamilyFor('600') }}>{label}</RNText>
    </AnimatedPressable>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
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
      <RNText style={{ color: t.colors.accentDeep, fontWeight: '700', fontSize: size * 0.36 }}>
        {initials}
      </RNText>
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
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.line }} />;
}

/** Format minor units (paise) as ₹ currency. */
export function formatINR(minor: number): string {
  return '₹' + (minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
