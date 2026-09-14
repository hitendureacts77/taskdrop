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
import { SetupScreen } from '../screens/SetupScreen';
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
import { AdminScreen } from '../screens/AdminScreen';
import { PromoteScreen } from '../screens/PromoteScreen';
import { SearchScreen } from '../screens/SearchScreen';

// Screens that show the bottom tab bar (the main app tabs).
const TABBED: ScreenName[] = ['home', 'search', 'orders', 'wallet', 'profile'];

// Registry. Screens the agent team hasn't delivered yet fall back to Placeholder.
const REGISTRY: Partial<Record<ScreenName, React.ComponentType>> = {
  splash: SplashScreen,
  home: HomeScreen,
  welcome: WelcomeScreen,
  signup: SignupScreen,
  setup: SetupScreen,
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
  admin: AdminScreen,
  promote: PromoteScreen,
  search: SearchScreen,
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
