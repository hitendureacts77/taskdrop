import React, { useEffect, useRef } from 'react';
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
import { NARROW_CONTENT, WIDE_CONTENT, useLayout } from '../lib/layout';
import { FadeIn } from '../components/primitives';
import { CreateFab } from '../components/CreateFab';
import { SplashScreen } from '../screens/SplashScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { Placeholder } from '../screens/Placeholder';
// Discovery
import { TaskDetailScreen } from '../screens/TaskDetailScreen';
import { DetailSheetScreen } from '../screens/DetailSheetScreen';
// Onboarding (Haiku agent)
import { AccessScreen } from '../screens/AccessScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
// Task flow (Sonnet agent)
import { CreateScreen } from '../screens/CreateScreen';
import { PostDetailsScreen } from '../screens/PostDetailsScreen';
import { CompareScreen } from '../screens/CompareScreen';
import { MyQuotesScreen } from '../screens/MyQuotesScreen';
import { ConfirmScreen } from '../screens/ConfirmScreen';
import { EscrowScreen } from '../screens/EscrowScreen';
// Active work (Sonnet agent)
import { SwipeScreen } from '../screens/SwipeScreen';
import { ActiveScreen } from '../screens/ActiveScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
// Money & profile (Sonnet agent)
import { SpendingScreen, WalletScreen } from '../screens/WalletScreen';
import { WithdrawScreen } from '../screens/WithdrawScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { PromoteScreen } from '../screens/PromoteScreen';
import { SearchScreen } from '../screens/SearchScreen';
// Second wave: AI posting, explore, my tasks and the account surfaces
import { AiPostScreen } from '../screens/AiPostScreen';
import { ExploreScreen } from '../screens/ExploreScreen';
import { MyTasksScreen } from '../screens/MyTasksScreen';
import { TaskManageScreen } from '../screens/TaskManageScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { HelpScreen, TicketScreen } from '../screens/HelpScreen';
import { PricingScreen } from '../screens/PricingScreen';
import { DisputesScreen } from '../screens/DisputesScreen';
import { ProfileEditScreen } from '../screens/ProfileEditScreen';
import { PublicProfileScreen } from '../screens/PublicProfileScreen';
import { SavedScreen } from '../screens/SavedScreen';
import { WorkerSetupScreen } from '../screens/WorkerSetupScreen';
import { ListingEditScreen } from '../screens/ListingEditScreen';

// Screens that show the bottom tab bar (the main app tabs).
// search and orders are no longer tabs, but they keep the bar when reached.
const TABBED: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'profile', 'search', 'orders'];

// The bottom-bar tabs stay mounted once visited, hidden while another screen
// is in front. Switching tabs or coming back from a task is then instant --
// the list, its scroll position and its images are still there -- instead of
// rebuilding the screen and fetching everything again behind a skeleton.
const KEEP_ALIVE: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'profile'];

// Desktop web: screens shown before sign-in, and screens given the wide column.
const PRE_AUTH: ScreenName[] = ['splash', 'welcome', 'signup', 'setup'];
const WIDE: ScreenName[] = ['home', 'explore', 'myTasks', 'search', 'orders', 'saved', 'wallet', 'spending', 'profile'];

// Registry. Screens the agent team hasn't delivered yet fall back to Placeholder.
const REGISTRY: Partial<Record<ScreenName, React.ComponentType>> = {
  splash: SplashScreen,
  home: HomeScreen,
  // One way in for everyone: new and returning people share this screen.
  welcome: AccessScreen,
  signup: AccessScreen,
  setup: OnboardingScreen,
  taskDetail: TaskDetailScreen,
  detailSheet: DetailSheetScreen,
  create: CreateScreen,
  postDetails: PostDetailsScreen,
  compare: CompareScreen,
  myQuotes: MyQuotesScreen,
  confirm: ConfirmScreen,
  escrow: EscrowScreen,
  swipe: SwipeScreen,
  active: ActiveScreen,
  chat: ChatScreen,
  review: ReviewScreen,
  wallet: WalletScreen,
  withdraw: WithdrawScreen,
  orders: OrdersScreen,
  profile: ProfileScreen,
  analytics: AnalyticsScreen,
  spending: SpendingScreen,
  promote: PromoteScreen,
  search: SearchScreen,
  aiPost: AiPostScreen,
  explore: ExploreScreen,
  myTasks: MyTasksScreen,
  taskManage: TaskManageScreen,
  notifications: NotificationsScreen,
  inbox: InboxScreen,
  account: AccountScreen,
  help: HelpScreen,
  ticket: TicketScreen,
  pricing: PricingScreen,
  disputes: DisputesScreen,
  profileEdit: ProfileEditScreen,
  publicProfile: PublicProfileScreen,
  saved: SavedScreen,
  workerSetup: WorkerSetupScreen,
  listing: ListingEditScreen,
};

export function ScreenHost() {
  const t = useTheme();
  const { screen, params, go } = useNav();
  const { userId } = useAuth();
  const { desktop } = useLayout();
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
          // A screen opened on top eases in rather than snapping into place.
          <FadeIn key={screen} duration={220} translateY={10} style={{ flex: 1 }}>
            {Comp ? <Comp /> : <Placeholder name={screen} />}
          </FadeIn>
        )}
      </View>
  );

  // Desktop web: sign-in screens get the split brand/form layout; the app gets
  // the sidebar (in place of the tab bar and the + button) and a centred column.
  if (desktop && PRE_AUTH.includes(screen)) {
    return <DesktopAuthFrame>{content}</DesktopAuthFrame>;
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
      {screen === 'home' && <CreateFab />}
      {TABBED.includes(screen) && <BottomTabBar />}
    </View>
  );
}
