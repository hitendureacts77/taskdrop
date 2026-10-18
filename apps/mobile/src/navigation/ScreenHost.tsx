import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { ScreenScope, useNav, type NavParams, type ScreenName } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { incomingTaskId, clearIncomingTask } from '../lib/links';
import { getTask } from '../data/api';
import { roughPlace } from '../lib/place';
import { BottomTabBar } from '../components/BottomTabBar';
import { SideNav } from '../components/SideNav';
import { DesktopAuthFrame } from '../components/DesktopAuthFrame';
import { NARROW_CONTENT, TABLET_CONTENT, WIDE_CONTENT, useLayout } from '../lib/layout';
import { FadeIn } from '../components/primitives';
import { useKeyboardOpen } from '../lib/useKeyboardOpen';
import { CreateFab } from '../components/CreateFab';
import { Placeholder } from '../screens/Placeholder';
import { REGISTRY } from './registry';
// Screens that show the bottom tab bar (the main app tabs).
// search and orders are no longer tabs, but they keep the bar when reached.
export const TABBED: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'profile', 'search', 'orders'];

// The bottom-bar tabs stay mounted once visited, hidden while another screen
// is in front. Switching tabs or coming back from a task is then instant --
// the list, its scroll position and its images are still there -- instead of
// rebuilding the screen and fetching everything again behind a skeleton.
export const KEEP_ALIVE: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'profile'];

// Desktop web: screens shown before sign-in, and screens given the wide column.
const PRE_AUTH: ScreenName[] = ['splash', 'welcome', 'signup', 'setup'];
// Pages anyone may read; signed out on desktop they get the sign-in frame.
const PUBLIC: ScreenName[] = ['copyright', 'terms', 'privacy'];
const WIDE: ScreenName[] = ['home', 'explore', 'myTasks', 'search', 'orders', 'saved', 'wallet', 'spending', 'profile', 'inbox', 'taskManage'];


export function ScreenHost() {
  const t = useTheme();
  const { screen, params, go } = useNav();
  const { userId } = useAuth();
  const { desktop, tablet } = useLayout();
  const keyboardOpen = useKeyboardOpen();
  const Comp = REGISTRY[screen];

  // Which tabs are alive, with the params each last had and how many times it
  // has come back into view. Worked out during render, so a tab shows on the
  // same frame it is chosen. Everything is dropped when the user changes.
  const kept = useRef(new Map<ScreenName, { params: NavParams; focus: number }>());
  const prevScreen = useRef<ScreenName | null>(null);
  const keptFor = useRef(userId);
  if (keptFor.current !== userId) {
    kept.current.clear();
    keptFor.current = userId;
  }
  if (KEEP_ALIVE.includes(screen)) {
    const cur = kept.current.get(screen);
    const returning = prevScreen.current !== screen && cur !== undefined;
    if (!cur || cur.params !== params || returning) {
      kept.current.set(screen, { params, focus: (cur?.focus ?? 0) + (returning ? 1 : 0) });
    }
  }
  prevScreen.current = screen;

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
        if (!task) return;
        go('taskDetail', {
          row: {
            id: task.id,
            sponsored: false,
            who: 'Customer',
            rating: '—',
            whoMeta: roughPlace(task.loc_label) ?? '',
            tag: 'SERVICES',
            title: task.title,
            meta: roughPlace(task.loc_label) ?? '',
            amountMinor: task.benchmark_minor,
            hasMedia: false,
            glyph: '',
            dur: null,
            body: task.description,
            by: null,
          },
        });
      } catch {
        clearIncomingTask();
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
              <ScreenScope params={k.params} focus={k.focus}>
                <Tab />
              </ScreenScope>
            </View>
          );
        })}
        {KEEP_ALIVE.includes(screen) ? null : (
          // A screen opened on top eases in rather than snapping into place
          // (SYS-Motion "screen push": a short rise plus a fade).
          <FadeIn key={screen} duration={320} translateY={14} style={{ flex: 1 }}>
            {Comp ? <Comp /> : <Placeholder name={screen} />}
          </FadeIn>
        )}
      </View>
  );

  // Desktop web: sign-in screens get the split brand/form layout; the app gets
  // the sidebar (in place of the tab bar and the + button) and a centred column.
  if (desktop && (PRE_AUTH.includes(screen) || (!userId && PUBLIC.includes(screen)))) {
    return <DesktopAuthFrame>{content}</DesktopAuthFrame>;
  }
  // Tablet web: the icon rail in place of the tab bar, content centred.
  if (tablet && !PRE_AUTH.includes(screen) && (userId || !PUBLIC.includes(screen))) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
        <SideNav rail />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ flex: 1, width: '100%', maxWidth: TABLET_CONTENT }}>{content}</View>
        </View>
      </View>
    );
  }
  if (desktop) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.colors.bg }}>
        <SideNav />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ flex: 1, width: '100%', maxWidth: WIDE.includes(screen) ? WIDE_CONTENT : NARROW_CONTENT }}>
            {content}
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
