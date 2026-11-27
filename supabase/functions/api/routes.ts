/**
 * The api's endpoints: one address per operation, grouped by what it is about.
 *
 *   POST /functions/v1/api/<group>/<op>   { "args": { ... } }
 *   e.g. POST /functions/v1/api/tasks/listOpenTasks
 *        POST /functions/v1/api/bids/placeBid
 *        POST /functions/v1/api/wallet/requestWithdrawal
 *   POST /functions/v1/api/batch           { "args": { "calls": [{ "op", "args" }, ...] } }   reads only
 *   POST /functions/v1/api/health          uptime check, no sign-in
 *
 * Still one deployed Edge Function (Supabase's advice for a big app: one warm function with routes, not one cold
 * start per endpoint). The sign-in check, rate limits, admin switches and repeat keys run the same way in front of
 * every endpoint (./index.ts). See docs/API_ENDPOINTS.md.
 *
 * The old address, POST /functions/v1/api with `{ "op", "args" }` in the body, keeps working for app builds that
 * were installed before this change.
 *
 * The app builds its addresses from this same file (apps/mobile/src/lib/gateway.ts), so the two cannot drift.
 * No imports on purpose: it is bundled into the app as well as the function, and tested from Node.
 */

export const API_GROUPS = {
  tasks: [
    "listOpenTasks", "listMyTasks", "searchTasks", "searchTasksWithPosters", "searchSuggest", "searchFallbacks", "attachPosters", "getTask", "getTaskDetail",
    "getPosterStats", "recommendedTasks", "remoteTasks", "tasksNear", "urgentTasks", "nearbyPulse", "countNeedsAttention",
    "taskContactPhone", "createTask", "updateListing", "removeListing", "cancelTask", "setRepeat", "setTaskDue", "raiseTopUp",
    "listSavedTaskIds", "listSavedTasks", "setSaved",
  ],
  questions: ["listTaskQuestions", "askTaskQuestion", "answerTaskQuestion"],
  bids: ["listMyBids", "listBidsForTask", "countBidsByTask", "myBidTaskIds", "getMyBid", "canQuoteOn", "placeBid", "updateBid", "lockBid"],
  jobs: ["listMyAssignments", "startTask", "markWorkDone", "submitProof", "getProof", "requestRevision", "confirmRelease"],
  disputes: ["listMyDisputes", "listDisputeReasons", "openDispute"],
  profile: [
    "getProfile", "isAdmin", "usernameAvailable", "updateProfile", "updateProfileExtras", "ageStatus", "recordBirthDate",
    "myStats", "myStreaks", "myRegulars", "notifyHelperAboutTask", "setWeeklyGoal",
  ],
  reviews: ["listReviewsAbout", "publicProfileStats", "workerProofPhotos", "submitReview"],
  workers: ["listActiveWorkers", "workersNear", "workerServices", "topEarners"],
  map: ["mapPeople", "mapSharing", "setMapSharing", "setMapAudience", "clearMapSpot"],
  crew: ["crewOverview", "listCrewMessages", "sendCrewMessage"],
  hunt: ["huntFinds", "huntCounts", "huntLook", "huntSendFind", "huntAcceptFind", "huntDeclineFind", "huntAskPart"],
  wallet: [
    "getWallet", "getEscrowHeld", "listWalletActivity", "getMoneyMode", "getTaskHold", "getMoneyLedger", "feesSince", "settleClearedEarnings", "payTaskFromWallet",
    "listPayouts", "requestWithdrawal", "cancelWithdrawal",
    "listPayoutDestinations", "addPayoutDestination", "removePayoutDestination", "setDefaultPayoutDestination",
  ],
  promotions: [
    "promotableTasks", "promotableTasksPage", "promotionTiers", "listPromotions", "adAuctionRanks", "startPromotion", "activatePromotion",
    "cancelPromotion", "recordAdImpression", "recordAdClick",
    "promotionQuote", "promotedLive", "promotionResults", "recordPromoView",
    "setPromoAlerts",
  ],
  platform: ["platformFees", "platformStats", "platformHighlights", "trendingCategories"],
  messages: ["listThreads", "listMessages", "chatState", "sendMessage"],
  notifications: [
    "listNotifications", "getNotification", "countUnreadNotifications", "countUnreadFor", "notificationSides",
    "markNotificationsRead", "registerPushToken", "forgetPushToken",
  ],
  account: ["touchPresence", "recordDevice", "accountDeletionCheck", "deleteMyAccount", "endMySessions"],
  safety: ["listBlockedUsers", "blockUser", "unblockUser", "reportContent"],
  feedback: ["listFeedbackBoard", "getFeedbackPost", "sendFeedback", "postFeedbackIdea", "voteFeedbackIdea", "commentFeedbackIdea"],
  support: ["listTickets", "getTicket", "openTicket", "replyTicket", "resolveTicket"],
  referrals: ["countMyReferrals", "applyReferralCode"],
  catalog: ["listCatalog", "checkCatalogTerm", "addCatalogTerm"],
  media: ["createUpload", "attachMedia", "signMedia", "removeMedia"],
} as const satisfies Record<string, readonly string[]>;

export type ApiGroup = keyof typeof API_GROUPS;

/** Which group each operation's endpoint sits under. */
export const GROUP_OF: Readonly<Record<string, ApiGroup>> = Object.freeze(
  Object.fromEntries(
    (Object.entries(API_GROUPS) as [ApiGroup, readonly string[]][]).flatMap(([group, ops]) => ops.map((op) => [op, group])),
  ),
);

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The path of an operation's endpoint below /functions/v1/, as the app passes it to `functions.invoke`:
 * `api/tasks/listOpenTasks`, `api/batch`. An operation this file does not know goes to the old single address
 * (`api`, with the op in the body), so an app ahead of its server still works.
 */
export function endpointOf(op: string): string {
  if (op === "batch" || op === "health") return `api/${op}`;
  return has(GROUP_OF, op) ? `api/${GROUP_OF[op]}/${op}` : "api";
}

export type Route =
  /** The old single address: the op comes from the body. */
  | { kind: "legacy" }
  | { kind: "op"; op: string; group: ApiGroup }
  | { kind: "batch" }
  | { kind: "health" }
  /** No such endpoint: answered 404. */
  | { kind: "unknown" };

/**
 * Which endpoint a request's path names. Works whether the runtime hands over `/api/...` (hosted) or
 * `/functions/v1/api/...` (some local set-ups); a trailing slash and an empty segment are ignored.
 */
export function routeOf(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  const at = parts.indexOf("api");
  const rest = at < 0 ? [] : parts.slice(at + 1);
  if (rest.length === 0) return { kind: "legacy" };
  if (rest.length === 1) {
    if (rest[0] === "batch") return { kind: "batch" };
    if (rest[0] === "health") return { kind: "health" };
    return { kind: "unknown" };
  }
  if (rest.length !== 2) return { kind: "unknown" };
  const [group, op] = rest as [string, string];
  // The op must live under the group it is filed under: /wallet/listOpenTasks is not an endpoint.
  if (!has(GROUP_OF, op) || GROUP_OF[op] !== group) return { kind: "unknown" };
  return { kind: "op", op, group: group as ApiGroup };
}

/**
 * The `{ op, args }` the rest of the function works with, from the endpoint and the body.
 * An endpoint's own op wins; a body that names a different op is a mistake and is refused (null).
 * The app also sends the op in the body, so a server from before this change still understands it.
 */
export function requestFor(route: Route, body: unknown): { op?: unknown; args?: unknown } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as { op?: unknown; args?: unknown };
  if (route.kind === "legacy") return b;
  const op = route.kind === "op" ? route.op : route.kind;
  if (b.op !== undefined && b.op !== op) return null;
  return { op, args: b.args };
}
