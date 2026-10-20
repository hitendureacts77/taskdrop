import type { ComponentType } from 'react';
import type { ScreenName } from '../providers/NavProvider';
import { SplashScreen } from '../screens/SplashScreen';
import { HomeScreen } from '../screens/HomeScreen';
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
import { CopyrightScreen } from '../screens/CopyrightScreen';
import { PrivacyScreen, TermsScreen } from '../screens/LegalScreens';
import { SupportScreen } from '../screens/SupportScreen';


// Registry. Screens the agent team hasn't delivered yet fall back to Placeholder.
export const REGISTRY: Partial<Record<ScreenName, ComponentType>> = {
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
  copyright: CopyrightScreen,
  terms: TermsScreen,
  privacy: PrivacyScreen,
  support: SupportScreen,
};
