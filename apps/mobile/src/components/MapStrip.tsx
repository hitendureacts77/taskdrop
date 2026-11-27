import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Pressy, tx } from './primitives';
import { useLayout } from '../lib/layout';

/** The strip is short on purpose: a taste of the map, the full one is a tap away. */
export const STRIP_HEIGHT = 150;

/**
 * The Home map card shared by Earn (jobs) and Hire (helpers): a short live map with what is near over its
 * left side and "Open the map". Colours come from the mode's tokens, so Earn is blue and Hire is jade.
 */
export function MapStrip({
  map,
  kicker,
  title,
  titleLabel,
  onTitle,
  sub,
  subMuted = false,
  onOpenMap,
  testID,
}: {
  map: React.ReactNode;
  kicker: string;
  title: string;
  /** With onTitle, the title is a button (Earn: tap to change the distance). */
  titleLabel?: string;
  onTitle?: () => void;
  sub: string;
  subMuted?: boolean;
  onOpenMap: () => void;
  testID?: string;
}) {
  const t = useTheme();
  const { desktop } = useLayout();
  const titleText = (
    <RNText style={tx('800', 17, t.colors.ink, { letterSpacing: -0.3 })} numberOfLines={1}>
      {title}
    </RNText>
  );
  return (
    <View testID={testID} style={{ height: STRIP_HEIGHT, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2 }}>
      {map}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          maxWidth: '78%',
          paddingVertical: 14,
          paddingHorizontal: 16,
          gap: 3,
          justifyContent: 'center',
          backgroundColor: t.colors.surface,
          borderTopRightRadius: 20,
          borderBottomRightRadius: 20,
        }}
      >
        <RNText style={tx('800', 10.5, t.colors.accentDeep, { letterSpacing: 0.6 })} numberOfLines={1}>
          {kicker}
        </RNText>
        {onTitle ? (
          <Pressy onPress={onTitle} label={titleLabel ?? title} style={{ alignSelf: 'flex-start' }}>
            {titleText}
          </Pressy>
        ) : (
          titleText
        )}
        <RNText style={subMuted ? tx('500', 12, t.colors.muted) : tx('600', 12, t.colors.text)} numberOfLines={1}>
          {sub}
        </RNText>
        <Pressy
          onPress={onOpenMap}
          label="Open the map"
          style={{ marginTop: 6, alignSelf: 'flex-start', height: 32, paddingHorizontal: 14, borderRadius: desktop ? 10 : 16, backgroundColor: t.colors.btn, justifyContent: 'center' }}
        >
          <RNText style={tx('800', 12.5, t.colors.onBtn)}>Open the map</RNText>
        </Pressy>
      </View>
    </View>
  );
}
