import { Pressable, View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useLayout } from '../lib/layout';
import { WALK_COPY } from '../lib/walkthrough';
import { CONTENT_INSET } from '../navigation/DesktopPage';
import { Drop } from './Ripples';
import { Icon } from './Icon';
import { tx } from './primitives';

/**
 * Desktop web, before sign-in: a plain website sign-in page (owner, 27 Nov).
 *
 * The owner asked twice. First: "sign in as my first priority and walkthrough or demo as my second priority", and no
 * landing page. Then, after seeing a demo playing beside the form: "why are you showing demo while going through sign
 * in process, i want customer to sign in or use my app first, instead of looking the walkthrough".
 *
 * So the page is what a website's sign-in page is (the reference the owner gave is Upwork): the site's top bar with
 * the wordmark, the sign-in form on one card in the middle of the page, and nothing playing. The walkthrough is a
 * quiet link at the right of the top bar (`onHow`), for people who ask for it. "Continue as guest" is on the form
 * itself, so "use my app first" is one click.
 */

/** The top bar's height; the same bar the app keeps after sign-in (DesktopTopNav). */
export const AUTH_BAR_HEIGHT = 64;
/** The sign-in card: a website form's width. */
const CARD_WIDTH = 460;
const CARD_MAX_HEIGHT = 700;

export function DesktopAuthFrame({ children, onHow }: { children: React.ReactNode; onHow?: () => void }) {
  const t = useTheme();
  const { height, gutter, contentWidth } = useLayout();
  // A short window gives the card everything under the bar; a tall one keeps it a card, not a column.
  const short = height < AUTH_BAR_HEIGHT + CARD_MAX_HEIGHT + 48;
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <View
        style={{
          height: AUTH_BAR_HEIGHT,
          backgroundColor: t.colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.line,
          alignItems: 'center',
          paddingHorizontal: gutter,
        }}
      >
        {/* The same line-up as the app's top bar (DesktopTopNav), so the wordmark does not jump on sign-in. */}
        <View
          style={{
            flex: 1,
            width: '100%',
            maxWidth: contentWidth('feed'),
            paddingHorizontal: CONTENT_INSET,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Drop size={26} fill={t.colors.heroMid} tick="#FFFFFF" />
            <RNText accessibilityRole="header" style={tx('800', 21, t.colors.ink, { letterSpacing: -0.7 })}>
              taskdrop<RNText style={{ color: t.colors.accent }}>.</RNText>
            </RNText>
          </View>
          {onHow ? (
            <Pressable
              onPress={onHow}
              accessibilityRole="link"
              accessibilityLabel={WALK_COPY.header}
              style={({ hovered }: { hovered?: boolean; pressed: boolean }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 36,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: hovered ? t.colors.surface2 : 'transparent',
              })}
            >
              <Icon name="sparkle" size={15} color={t.colors.muted} />
              <RNText style={tx('600', 14, t.colors.text)}>{WALK_COPY.header}</RNText>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: short ? 16 : 24 }}>
        <View
          style={{
            width: '100%',
            maxWidth: CARD_WIDTH,
            flex: 1,
            maxHeight: CARD_MAX_HEIGHT,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 20,
            overflow: 'hidden',
            paddingHorizontal: 14,
          }}
        >
          {children}
        </View>
      </View>
    </View>
  );
}
