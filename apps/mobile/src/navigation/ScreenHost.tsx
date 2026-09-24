import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { incomingTaskId, clearIncomingTask } from '../lib/links';
import { getTask } from '../data/api';
import { BottomTabBar } from '../components/BottomTabBar';
import { CreateFab } from '../components/CreateFab';
import { SplashScreen } from '../screens/SplashScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { Placeholder } from '../screens/Placeholder';
// Discovery
import { TaskDetailScreen } from '../screens/TaskDetailScreen';
import { DetailSheetScreen } from '../screens/DetailSheetScreen';
// Onboarding (Haiku agent)
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { SignupScreen } from '../screens/SignupScreen';
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
import { WalletScreen } from '../screens/WalletScreen';
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

// Screens that show the bottom tab bar (the main app tabs).
// search and orders are no longer tabs, but they keep the bar when reached.
const TABBED: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'profile', 'search', 'orders'];

// Registry. Screens the agent team hasn't delivered yet fall back to Placeholder.
const REGISTRY: Partial<Record<ScreenName, React.ComponentType>> = {
  splash: SplashScreen,
  home: HomeScreen,
  welcome: WelcomeScreen,
  signup: SignupScreen,
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
};

export function ScreenHost() {
  const t = useTheme();
  const { screen, go } = useNav();
  const Comp = REGISTRY[screen];

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
            who: 'Poster',
            rating: '—',
            whoMeta: task.loc_label ?? '',
            tag: 'SERVICES',
            title: task.title,
            meta: task.loc_label ?? '',
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

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <View style={{ flex: 1 }}>{Comp ? <Comp /> : <Placeholder name={screen} />}</View>
      {screen === 'home' && <CreateFab />}
      {TABBED.includes(screen) && <BottomTabBar />}
    </View>
  );
}
