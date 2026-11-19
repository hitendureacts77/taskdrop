import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { ScreenScope, useNav, type NavParams, type ScreenName } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { incomingTaskId, clearIncomingTask } from '../lib/links';
import { getTask } from '../data/api';
import { roughPlace } from '../lib/place';
import { taskLinkTarget } from '../lib/taskLink';
import { usesAuthFrame } from './frame';
import { PUBLIC_PAGES, pathForScreen, titleForScreen } from './webAddress';
import { useMode } from '../providers/ModeProvider';
import { BottomTabBar } from '../components/BottomTabBar';
import { SideNav } from '../components/SideNav';
import { DesktopAuthFrame } from '../components/DesktopAuthFrame';
import { TABLET_CONTENT, useLayout, type ColumnClass } from '../lib/layout';
import { DesktopPageFrame, DesktopPageScope } from './DesktopPage';
import { FadeIn, tx } from '../components/primitives';
import { useKeyboardOpen } from '../lib/useKeyboardOpen';
import { CreateFab } from '../components/CreateFab';
import { Placeholder } from '../screens/Placeholder';
import { REGISTRY } from './registry';
import { isFresh, screenMayReuse, stamp, type Stamp } from '../lib/freshness';
import { hasPendingAccountAction } from '../lib/guest';
// Screens that show the bottom tab bar (the main app tabs).
// search and orders are no longer tabs, but they keep the bar when reached.
export const TABBED: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'profile', 'search', 'orders'];

// The bottom-bar tabs stay mounted once visited, hidden while another screen
// is in front. Switching tabs or coming back from a task is then instant --
// the list, its scroll position and its images are still there -- instead of
// rebuilding the screen and fetching everything again behind a skeleton.
export const KEEP_ALIVE: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'profile'];

// Desktop web: which screens get the signed-out frame is in ./frame.ts (PRE_AUTH, PUBLIC).
// Desktop column classes (lib/layout.ts, docs/design/desktop-fit/PLAN.md Q1).
// Feeds and lists: as wide as the window allows, up to FEED_MAX. workerSetup is here for its FormPage card (720) + aside (320).
const WIDE: ScreenName[] = ['home', 'explore', 'myTasks', 'orders', 'saved', 'wallet', 'spending', 'inbox', 'taskManage', 'help', 'notifications', 'workerSetup'];
// One list or one page of text: up to READ_MAX.
const READ: ScreenName[] = ['search', 'chat', 'copyright', 'terms', 'privacy', 'support', 'ideas', 'ideaDetail'];
// Screens that fill everything beside the menu: a full map has no reading column.
const FULL: ScreenName[] = ['nearMap', 'explore'];
// Two-pane pages (components/TwoPane.tsx): the feed width when both panes fit,
// otherwise their one column at FORM_MAX, as before.
const TWO_PANE: ScreenName[] = ['taskDetail', 'profile', 'account', 'publicProfile', 'active'];
// Everything else is a form or a single page: FORM_MAX, as before.
function columnFor(screen: ScreenName, twoPane: boolean): ColumnClass {
  if (FULL.includes(screen)) return 'full';
  if (WIDE.includes(screen)) return 'feed';
  if (TWO_PANE.includes(screen)) return twoPane ? 'feed' : 'form';
  if (READ.includes(screen)) return 'read';
  return 'form';
}


export function ScreenHost() {
  const t = useTheme();
  const { screen, params, go } = useNav();
  const { userId, guest } = useAuth();
  const { desktop, tablet, gutter, contentWidth, twoPane } = useLayout();
  const keyboardOpen = useKeyboardOpen();
  const Comp = REGISTRY[screen];

  // Which tabs are alive, with the params each last had and how many times it
  // has come back into view. Worked out during render, so a tab shows on the
  // same frame it is chosen. Everything is dropped when the user changes.
  // Coming back only counts (and so refreshes the tab) when the tab is not
  // fresh: loaded half a minute ago or more, or something changed since
  // (lib/freshness.ts). Back from a quick look at a task, nothing is re-asked.
  const kept = useRef(new Map<ScreenName, { params: NavParams; focus: number; loaded: Stamp }>());
  const prevScreen = useRef<ScreenName | null>(null);
  const keptFor = useRef(userId);
  // Not when a guest has just made their account to finish something (an offer half-written in a
  // sheet on Home): nothing on those tabs was anyone else's, and dropping them would drop that offer.
  if (keptFor.current !== userId) {
    if (!(keptFor.current === null && hasPendingAccountAction())) kept.current.clear();
    keptFor.current = userId;
  }
  if (KEEP_ALIVE.includes(screen)) {
    const cur = kept.current.get(screen);
    // The wallet always counts (3.5b): money is never shown from what was read before.
    const returning = prevScreen.current !== screen && cur !== undefined && (!screenMayReuse(screen) || !isFresh(cur.loaded));
    if (!cur || cur.params !== params || returning) {
      kept.current.set(screen, {
        params,
        focus: (cur?.focus ?? 0) + (returning ? 1 : 0),
        loaded: !cur || returning ? stamp() : cur.loaded,
      });
    }
  }
  prevScreen.current = screen;

  // Web: each screen names the browser tab (B179). ScreenHost only runs on web.
  const { mode } = useMode();
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = titleForScreen(screen, mode);
  }, [screen, mode]);
  // Web: Terms, Privacy, Support and Copyright keep their own address while open (B171). Replaced, never
  // pushed, so Back behaves as before; every other screen keeps the plain address.
  // The address is only put back to "/" after a public page was shown, so an arriving /privacy is never
  // cleared before PublicPageLink has opened it.
  const shownPublic = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    if ((PUBLIC_PAGES as readonly string[]).includes(screen)) shownPublic.current = true;
    const path = pathForScreen(screen, window.location.pathname);
    if (path === null || (path === '/' && !shownPublic.current)) return;
    window.history.replaceState(window.history.state, '', path + window.location.search + window.location.hash);
  }, [screen]);

  // A shared link (?task=<id>) has to land on that task, otherwise every link
  // anyone sends just opens the feed. Runs once, then clears the query so a
  // reload or a back-navigation doesn't reopen it.
  const handledLink = useRef(false);
  useEffect(() => {
    if (handledLink.current) return;
    // (?page= links are handled by PublicPageLink, outside the age gate.)
    const id = incomingTaskId();
    if (!id) return;
    handledLink.current = true;
    void (async () => {
      try {
        const task = await getTask(id);
        clearIncomingTask();
        // A task that does not exist (or is closed) says so, with a way back (B148), instead of silently Home.
        const to = taskLinkTarget(task, roughPlace);
        go(to.screen, to.params);
      } catch {
        clearIncomingTask();
        const to = taskLinkTarget(null, roughPlace);
        go(to.screen, to.params);
      }
    })();
  }, [go]);

  const content = (
      <View style={{ flex: 1 }}>
        {[...kept.current].map(([name, k]) => {
          const Tab = REGISTRY[name];
          if (!Tab) return null;
          return (
            <View key={name} style={{ flex: 1, display: name === screen ? 'flex' : 'none' }}>
              {/* Desktop: only the tab in front may put its title in the page header. */}
              <DesktopPageScope active={name === screen}>
                <ScreenScope params={k.params} focus={k.focus}>
                  <Tab />
                </ScreenScope>
              </DesktopPageScope>
            </View>
          );
        })}
        {KEEP_ALIVE.includes(screen) ? null : (
          // A screen opened on top eases in rather than snapping into place
          // (SYS-Motion "screen push": a short rise plus a fade).
          <FadeIn key={screen} duration={320} translateY={14} style={{ flex: 1 }}>
            <DesktopPageScope active>{Comp ? <Comp /> : <Placeholder name={screen} />}</DesktopPageScope>
          </FadeIn>
        )}
      </View>
  );

  // Desktop web: sign-in screens get the split brand/form layout; the app gets
  // the sidebar (in place of the tab bar and the + button) and a centred column.
  // A guest is inside the app too: the public pages keep the app's frame for them (B149, navigation/frame.ts).
  const inApp = Boolean(userId) || guest;
  // Setup (onboarding) on a desktop: the FormPage card (720) with the steps beside it (320), centred, no menu.
  // The signed-out frame's 440 card cannot hold it (docs/design/desktop-web/PLAN.md, package 4). Tablet and phone keep that frame.
  if (desktop && screen === 'setup') {
    return (
      <View style={{ flex: 1, alignItems: 'center', backgroundColor: t.colors.bg, paddingHorizontal: gutter }}>
        <View style={{ flex: 1, width: '100%', maxWidth: 720 + 24 + 320 }}>
          <Text style={tx('800', 22, t.colors.ink, { letterSpacing: -0.8, paddingTop: 28, paddingBottom: 12 })}>
            taskdrop<Text style={{ color: t.colors.accent }}>.</Text>
          </Text>
          {content}
        </View>
      </View>
    );
  }
  if (desktop && usesAuthFrame(screen, inApp)) {
    return <DesktopAuthFrame>{content}</DesktopAuthFrame>;
  }
  // Tablet web: the icon rail in place of the tab bar, content centred.
  if (tablet && !usesAuthFrame(screen, inApp)) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
        <SideNav rail />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ flex: 1, width: '100%', maxWidth: FULL.includes(screen) ? undefined : TABLET_CONTENT }}>{content}</View>
        </View>
      </View>
    );
  }
  if (desktop) {
    // A column of the screen's class with a gutter each side, under the page
    // header (DesktopPage.tsx); full maps fill the whole area and keep their
    // own floating controls.
    const cls = columnFor(screen, twoPane);
    const full = cls === 'full';
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
        <SideNav />
        <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: full ? 0 : gutter }}>
          <View style={{ flex: 1, width: '100%', maxWidth: full ? undefined : contentWidth(cls) }}>
            <DesktopPageFrame screen={screen} header={!full}>
              {content}
            </DesktopPageFrame>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {content}
      {screen === 'home' && !keyboardOpen && <CreateFab />}
      {TABBED.includes(screen) && !keyboardOpen && <BottomTabBar />}
    </View>
  );
}
