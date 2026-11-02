/**
 * Lightweight screen navigator that mirrors the design's own tab-state model.
 * Keeps a simple stack so `back()` works. Screen names match the design.
 */
export type ScreenName =
  | 'splash'
  | 'welcome'
  | 'signup'
  | 'setup'
  | 'home'
  | 'search'
  | 'create'
  | 'postDetails'
  | 'taskDetail'
  | 'detailSheet'
  | 'compare'
  | 'myQuotes'
  | 'confirm'
  | 'escrow'
  | 'swipe'
  | 'active'
  | 'chat'
  | 'orders'
  | 'wallet'
  | 'withdraw'
  | 'promote'
  | 'review'
  | 'profile'
  | 'analytics'
  | 'spending'
  // Second wave: AI posting, explore, my tasks and the account surfaces.
  | 'aiPost'
  | 'explore'
  | 'myTasks'
  | 'taskManage'
  | 'notifications'
  | 'inbox'
  | 'account'
  | 'help'
  | 'ticket'
  | 'pricing'
  | 'disputes'
  | 'profileEdit'
  | 'publicProfile'
  | 'saved'
  | 'nearMap'
  | 'workerSetup'
  | 'listing'
  // Poster options (migration 134): a crew job, the people hired before, the Earn side's streaks.
  | 'crew'
  | 'regulars'
  | 'streaks'
  // The public feedback board (migration 136).
  | 'ideas'
  | 'ideaDetail'
  // Public: reachable signed out, and by link (?page=copyright etc.).
  | 'copyright'
  | 'terms'
  | 'privacy'
  | 'support';

export type NavParams = Record<string, unknown>;
