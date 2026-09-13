import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
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
import { ProScreen } from '../screens/ProScreen';
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
  pro: ProScreen,
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
  promote: PromoteScreen,
  search: SearchScreen,
};

export function ScreenHost() {
  const t = useTheme();
  const { screen } = useNav();
  const Comp = REGISTRY[screen];

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <View style={{ flex: 1 }}>{Comp ? <Comp /> : <Placeholder name={screen} />}</View>
      {screen === 'home' && <CreateFab />}
      {TABBED.includes(screen) && <BottomTabBar />}
    </View>
  );
}
