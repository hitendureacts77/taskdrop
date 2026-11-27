import { useCallback, useContext, useMemo, useState } from 'react';
import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useMode } from '../providers/ModeProvider';
import { tx } from '../components/primitives';
import { nameForScreen } from './webAddress';
import { DesktopPageHostsContext, DesktopPageScopeContext, type DesktopPageHosts } from './desktopPageContext';

/** The page header's content lines up with the screens' own content, this far in from the column edge. */
export const CONTENT_INSET = 20;

/**
 * Desktop web only (docs/design/desktop-web/PLAN.md, 4.1): the page's own heading row, at the top of every screen's
 * column, under the site's top bar (components/DesktopTopNav.tsx). Left: the page title (and, on pushed screens, a
 * small "Back" link and a subtitle). Right: the screen's own buttons. The bell, messages and face are in the top bar.
 *
 * The title is the screen's name (`nameForScreen`) unless the screen draws its own: a `TopBar` or `BackButton`
 * on a desktop draws nothing in the page and portals its title, back link and buttons in here instead
 * (components/pageHeader.web.tsx), so they keep working with the screen's own state. Home has no title: its hero is.
 *
 * One header for the whole column, not one per kept-alive tab: each tab would otherwise run its own copy of the
 * bell's unread count and live subscription. Instead each screen sits in a `DesktopPageScope`, and only the one in
 * front may draw into the header.
 */
export function DesktopPageFrame({
  screen,
  header,
  children,
}: {
  screen: string;
  /** False on full-window screens (the maps), which keep their own floating tools. */
  header: boolean;
  children: React.ReactNode;
}) {
  const [titleNode, setTitleNode] = useState<HTMLElement | null>(null);
  const [actionsNode, setActionsNode] = useState<HTMLElement | null>(null);
  const [centerNode, setCenterNode] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const claimTitle = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const hosts = useMemo<DesktopPageHosts>(
    () => ({ title: titleNode, actions: actionsNode, center: centerNode, claimTitle }),
    [titleNode, actionsNode, centerNode, claimTitle],
  );
  return (
    <DesktopPageHostsContext.Provider value={hosts}>
      {/* The screens always sit at the same place in the tree, header or not, so going to and from a map never
          rebuilds the kept-alive tabs. */}
      {header ? (
        <DesktopPageHeader
          screen={screen}
          showDefaultTitle={claims === 0}
          titleRef={setTitleNode}
          actionsRef={setActionsNode}
          centerRef={setCenterNode}
        />
      ) : null}
      {children}
    </DesktopPageHostsContext.Provider>
  );
}

/**
 * Marks one screen in the column: `active` when it is the one in front. Off a desktop there is no frame above it,
 * and it changes nothing.
 */
export function DesktopPageScope({ active, children }: { active: boolean; children: React.ReactNode }) {
  const hosts = useContext(DesktopPageHostsContext);
  const value = useMemo(() => (hosts ? { hosts, active } : null), [hosts, active]);
  return <DesktopPageScopeContext.Provider value={value}>{children}</DesktopPageScopeContext.Provider>;
}

/**
 * The header row itself. ScreenHost draws it through `DesktopPageFrame`; the Explore list (a full-width screen the
 * frame does not cover, because its map fills the window) draws it on its own, with no portal nodes.
 */
export function DesktopPageHeader({
  screen,
  showDefaultTitle = true,
  titleRef,
  actionsRef,
  centerRef,
}: {
  screen: string;
  showDefaultTitle?: boolean;
  titleRef?: (node: HTMLElement | null) => void;
  actionsRef?: (node: HTMLElement | null) => void;
  centerRef?: (node: HTMLElement | null) => void;
}) {
  const t = useTheme();
  const { mode } = useMode();
  const name = screen === 'home' ? null : nameForScreen(screen, mode);
  return (
    <>
    <View
      style={{
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: CONTENT_INSET,
        paddingTop: 22,
        paddingBottom: 12,
      }}
    >
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
        {showDefaultTitle && name ? (
          <RNText accessibilityRole="header" style={tx('800', 24, t.colors.ink, { letterSpacing: -0.5 })} numberOfLines={1}>
            {name}
          </RNText>
        ) : null}
        {/* react-native-web: a View's ref is its DOM element, which the portals draw into. */}
        <View ref={titleRef as never} />
      </View>
      {/* The middle slot (a search bar on Home and Find work, D31 web boards). Empty, it only takes up the
          free space, so the title stays left and the buttons right as before. */}
      <View ref={centerRef as never} style={{ flexGrow: 2, flexShrink: 1, minWidth: 0, maxWidth: 560 }} />
      <View ref={actionsRef as never} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} />
    </View>
    </>
  );
}
