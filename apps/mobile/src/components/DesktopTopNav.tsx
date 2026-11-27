import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { countNeedsAttention } from '../data/api';
import { useLayout } from '../lib/layout';
import { CONTENT_INSET } from '../navigation/DesktopPage';
import { HeaderTools } from './AppHeader';
import { TopNavAppLink } from './AppQr';
import { Icon } from './Icon';
import { ModeSwitch } from './ModeSwitch';
import { Drop } from './Ripples';
import { tx } from './primitives';

/** The desktop site bar's height, in layout px. */
export const TOP_NAV_HEIGHT = 64;

/**
 * Desktop web: the site's top bar (owner, 27 Nov: "i want it to look like desktop website, refer upwork website").
 *
 * Before, a desktop window had the phone app's menu down the left (SideNav) and each page stretched across what was
 * left. A website has one bar across the top and its pages in one centred column, so that is what this is:
 *
 *   wordmark · Home · Explore · My Tasks · Wallet            Hire/Earn · Post a request · help · bell · messages · face
 *
 * The bar's content lines up with the page column under it (the same gutter and cap as ScreenHost's feed column).
 * Same destinations, switch and attention badge as the side menu had; Profile, Settings and the rest are in the
 * account menu behind the face, where a website keeps them. Tablets keep the icon rail (SideNav rail).
 */
export function DesktopTopNav() {
  const t = useTheme();
  const { screen, go, reset } = useNav();
  const { mode } = useMode();
  const { userId } = useAuth();
  const { gutter, contentWidth, width } = useLayout();
  const worker = mode === 'worker';

  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    countNeedsAttention(userId, worker ? 'worker' : 'poster')
      .then((n) => alive && setWaiting(n))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, worker, screen]);

  const links: { key: ScreenName; label: string; badge?: number }[] = [
    { key: 'home', label: 'Home' },
    // Earn calls this item Find work, as the bottom tabs and the phone's native tabs already do.
    { key: 'explore', label: worker ? 'Find work' : 'Explore' },
    { key: 'myTasks', label: worker ? 'My Work' : 'My Tasks', badge: waiting },
    { key: 'wallet', label: 'Wallet' },
  ];
  // A narrow desktop window (1024 to about 1200 real px) drops the words that are spelled out elsewhere.
  const roomy = width >= 1320;

  return (
    <View
      accessibilityRole={'navigation' as never}
      style={{
        height: TOP_NAV_HEIGHT,
        backgroundColor: t.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.line,
        alignItems: 'center',
        paddingHorizontal: gutter,
        // Above the page, so a page's own shadow or a sticky row never draws over the bar.
        zIndex: 5,
      }}
    >
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: contentWidth('feed'),
          paddingHorizontal: CONTENT_INSET,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => reset('home')}
          accessibilityRole="link"
          accessibilityLabel="TaskDrop home"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 16 }}
        >
          <Drop size={26} fill={t.colors.accent} tick={t.isDark ? t.colors.bg : '#FFFFFF'} />
          <RNText style={tx('800', 21, t.colors.ink, { letterSpacing: -0.7 })}>
            taskdrop<RNText style={tx('800', 21, t.colors.accent)}>.</RNText>
          </RNText>
        </Pressable>

        <View style={{ flexDirection: 'row', alignSelf: 'stretch', gap: 4 }}>
          {links.map((it) => {
            const on = screen === it.key;
            return (
              <Pressable
                key={it.key}
                onPress={() => reset(it.key)}
                accessibilityRole="link"
                accessibilityLabel={it.badge ? `${it.label}, ${it.badge} needing attention` : it.label}
                accessibilityState={{ selected: on }}
                style={{ justifyContent: 'center', paddingHorizontal: 12 }}
              >
                {({ hovered }: { pressed: boolean; hovered?: boolean }) => (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <RNText style={tx(on ? '700' : '600', 14.5, on ? t.colors.accentDeep : hovered ? t.colors.ink : t.colors.text)}>
                        {it.label}
                      </RNText>
                      {it.badge ? (
                        <View
                          style={{
                            minWidth: 18,
                            height: 18,
                            paddingHorizontal: 5,
                            borderRadius: 9,
                            backgroundColor: t.colors.goldSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <RNText style={tx('800', 10.5, t.colors.goldInk)}>{it.badge > 9 ? '9+' : it.badge}</RNText>
                        </View>
                      ) : null}
                    </View>
                    {/* The page you are on: a short line on the bar's bottom edge, as on a website. */}
                    <View
                      style={{
                        position: 'absolute',
                        left: 12,
                        right: 12,
                        bottom: 0,
                        height: 3,
                        borderTopLeftRadius: 3,
                        borderTopRightRadius: 3,
                        backgroundColor: on ? t.colors.accent : 'transparent',
                      }}
                    />
                  </>
                )}
              </Pressable>
            );
          })}
        </View>

        <View style={{ flex: 1 }} />

        {roomy ? <TopNavAppLink /> : null}
        {/* Hire / Earn -- the same switch the phone header carries. */}
        <View style={{ justifyContent: 'center' }}>
          <ModeSwitch />
        </View>
        <Pressable
          collapsable={false}
          onPress={() => go(worker ? 'listing' : 'aiPost')}
          accessibilityRole="button"
          accessibilityLabel={worker ? 'Offer a service' : 'Post a request'}
          style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 38,
            paddingHorizontal: 14,
            borderRadius: 10,
            backgroundColor: t.colors.btn,
            opacity: pressed ? 0.85 : hovered ? 0.92 : 1,
          })}
        >
          <Icon name="plus" size={16} color={t.colors.onBtn} strokeWidth={2.4} />
          <RNText style={tx('700', 14, t.colors.onBtn)}>{worker ? 'Offer a service' : 'Post a request'}</RNText>
        </Pressable>
        <Pressable
          onPress={() => go('help')}
          accessibilityRole="link"
          accessibilityLabel="Help & support"
          accessibilityState={{ selected: screen === 'help' }}
          style={({ hovered }: { hovered?: boolean; pressed: boolean }) => ({
            width: 36,
            height: 36,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: hovered || screen === 'help' ? t.colors.surface2 : 'transparent',
          })}
        >
          <Icon name="help" size={19} color={t.colors.text} strokeWidth={1.8} />
        </Pressable>
        {/* Bell, messages and the face (its menu holds Profile, Settings and the rest); a guest gets "Sign in". */}
        <HeaderTools tight />
      </View>
    </View>
  );
}
