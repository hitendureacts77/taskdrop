import { Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import type { Theme } from '../theme';

/** The side a promoted post is shown to: Earn is always royal blue, Hire is always jade. */
export type PromoSide = 'earn' | 'hire';

/** The tokens one side uses: tint, ink and the border of a promoted card. */
export function promoColors(t: Theme, side: PromoSide) {
  return side === 'earn'
    ? { soft: t.colors.purpleSoft, ink: t.colors.purpleDeep, fill: t.colors.purpleFill, border: t.colors.purple }
    : { soft: t.colors.accentSoft, ink: t.colors.accentDeep, fill: t.colors.accentDeep, border: t.colors.accent };
}

/** Border style of a promoted card that won a top spot (1.5px, side colour). Others keep their normal border. */
export function promotedBorder(t: Theme, side: PromoSide, top: boolean) {
  return top ? { borderWidth: 1.5, borderColor: promoColors(t, side).border } : null;
}

/** Small "PROMOTED" pill: bolt icon, small caps, tinted for the side. */
export function PromotedPill({ side, style }: { side: PromoSide; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const c = promoColors(t, side);
  return (
    <View
      accessibilityLabel="Promoted"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: c.soft,
        },
        style,
      ]}
    >
      <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
        <Path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill={c.ink} />
      </Svg>
      <RNText style={tx('800', 9, c.ink, { letterSpacing: 1.4 })}>PROMOTED</RNText>
    </View>
  );
}

/** The dashed "Fair rules" note under a list that shows promoted posts. */
export function FairRulesNote({ text, side }: { text: string; side: PromoSide }) {
  const t = useTheme();
  const c = promoColors(t, side);
  return (
    <View
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: c.border,
      }}
    >
      <RNText style={tx('700', 11, c.ink, { letterSpacing: 0.4, marginBottom: 3 })}>Fair rules</RNText>
      <RNText style={tx('400', 12, t.colors.muted, { lineHeight: 17 })}>{text}</RNText>
    </View>
  );
}
