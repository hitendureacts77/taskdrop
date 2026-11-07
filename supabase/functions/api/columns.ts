/**
 * Fixed column lists for the api function (plan task 2.18 part A, hole H74).
 *
 * Row rules guard rows, not columns: every signed-in person can read every
 * column of the rows they may see. So the api never asks for "every column"
 * (`select("*")`); it names the columns, and a column added to a table later
 * reaches nobody until someone decides it here AND in
 * supabase/tests/column_decisions.test.sql (which fails on an undecided column).
 * docs/SECURITY_COLUMNS.md is the plain-words table of the same decisions.
 *
 * Public       - anyone signed in may see it on someone else's row.
 * Parties only - the poster and the hired worker of that task (staff aside).
 * Private      - the owner only; never in an answer about another person.
 */

type Row = Record<string, unknown>;

const join = (cols: readonly string[]) => cols.join(", ");

// --------------------------------------------------------------- profiles ----

/** Seen by every signed-in person on anyone's profile card. */
export const PROFILE_PUBLIC = [
  "id", "display_name", "avatar_url", "skills", "loc_lat", "loc_lng", "loc_label",
  "poster_rating_avg", "poster_rating_count", "worker_rating_avg", "worker_rating_count",
  "created_at", "updated_at", "onboarded_at", "username", "bio", "languages", "intent",
  "last_seen_at", "live_until", "worker_bio", "worker_onboarded_at", "deleted_at",
] as const;

/** Only the person themself: shown on their own row, never in an answer about someone else. */
export const PROFILE_PRIVATE = [
  "payout_upi", "sessions_revoked_at", "sessions_keep_session", "weekly_goal_minor", "referral_code",
] as const;

/** What a person's own profile read may add: the two fields their own screens use (referral code, weekly goal). */
export const PROFILE_OWNER_EXTRA = ["referral_code", "weekly_goal_minor"] as const;

export const PROFILE_COLUMNS = [...PROFILE_PUBLIC, ...PROFILE_PRIVATE] as const;
export const PROFILE_PUBLIC_SELECT = join(PROFILE_PUBLIC);
export const PROFILE_OWNER_SELECT = join([...PROFILE_PUBLIC, ...PROFILE_OWNER_EXTRA]);

// ------------------------------------------------------------------ tasks ----

/**
 * Money and hiring fields of a task. Only the poster and the hired worker may
 * see them; for anyone else (an open post's other readers, a bidder who lost)
 * `redactTask` drops them from the answer.
 */
export const TASK_PARTIES_ONLY = [
  "funded_minor", "funded_credits_minor", "funded_via", "funding_payment_id",
  "locked_minor", "locked_bid_id", "payout_mode", "wallet_refunded_at", "preferred_worker_id",
] as const;

/** Every other column of tasks: what anyone who can see the task may see. */
export const TASK_PUBLIC = [
  "id", "poster_id", "pillar", "title", "description", "benchmark_minor", "time_limit_minutes", "flag", "status",
  "media_kind", "media_path", "media_seconds", "loc_lat", "loc_lng", "loc_label",
  "started_at", "work_done_at", "auto_complete_at", "completed_at", "clear_at", "created_at", "updated_at",
  "cleared_at", "funded_at", "category", "skills", "difficulty", "assignment_mode", "due_at", "milestones", "kind",
  "topup_pct", "flash_until", "live_answer", "crew_id", "crew_size", "crew_slot", "repeat_every", "repeated_from",
  "preferred_until", "want_photos", "photos_public", "hunt_until", "hunt_window", "hunt_needs",
] as const;

export const TASK_COLUMNS = [...TASK_PUBLIC, ...TASK_PARTIES_ONLY] as const;
/** For a task row that is the caller's own (or the caller is hired on): every decided column. */
export const TASK_PARTY_SELECT = join(TASK_COLUMNS);
/** For a task row that may belong to someone else. */
export const TASK_PUBLIC_SELECT = join(TASK_PUBLIC);

/** The task with its parties-only fields removed (a copy). */
export function redactTask<T extends Row>(task: T): T {
  const copy: Row = { ...task };
  for (const k of TASK_PARTIES_ONLY) delete copy[k];
  return copy as T;
}

// ------------------------------------------------- tables seen by parties ----
// Every row of these is readable only by the people in the task, crew or
// thread (row rules), so each column is "parties only", except where noted.

/** bids: price and message are seen by the poster and the bidder only. */
export const BID_SELECT = "id, task_id, worker_id, price_minor, time_limit_minutes, message, is_locked, created_at";
/** assignments: the hold on one worker; poster and worker only. */
export const ASSIGNMENT_SELECT = "id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at";
/** task_proofs: what the worker handed in; poster and worker only. */
export const PROOF_SELECT = "id, task_id, worker_id, summary, files, created_at";
/** reviews: public by design (a person's reputation). */
export const REVIEW_SELECT = "id, task_id, author_id, subject_id, about_role, rating, comment, created_at";
/** messages: a task thread, the two people only. */
export const MESSAGE_SELECT = "id, task_id, sender_id, body, created_at";
/** crew_messages: the crew's shared chat, members only. */
export const CREW_MESSAGE_SELECT = "id, crew_id, sender_id, body, created_at";
/** support_messages: one ticket's thread, the ticket's owner and staff. */
export const SUPPORT_MESSAGE_SELECT = "id, ticket_id, sender_id, from_staff, body, created_at";

/** Embedded `tasks(...)` lists, for joins. */
export const TASKS_PARTY_EMBED = `tasks(${TASK_PARTY_SELECT})`;
export const TASKS_PUBLIC_EMBED = `tasks(${TASK_PUBLIC_SELECT})`;

// ------------------------------------------- tables that are only yours ----
// Every read of these asks for the caller's own rows (`user_id = the caller`,
// and row rules say the same), so the whole row is "private to its owner" and
// it may be sent to that owner. Still fixed lists: a new column is not sent
// until it is decided here. Nothing is dropped from what the app got before.

export const WALLET_SELECT = "user_id, balance_minor, clearing_minor, currency, updated_at, credits_minor";
export const PAYOUT_SELECT =
  "id, user_id, amount_minor, status, destination, failure_note, created_at, updated_at, reference, destination_id, provider_payout_id, mode, sent_at, via, attempts, last_attempt_at, provider_status, provider_status_at, fee_minor, tax_minor, reversed_at";
export const PAYMENT_SELECT =
  "id, user_id, task_id, purpose, amount_minor, status, provider, provider_ref, link_url, paid_at, created_at, updated_at, provider_payment_id, refunded_minor, refund_ref, refunded_at, credited_at, refund_claimed_at";
export const PAYOUT_DESTINATION_SELECT =
  "id, user_id, kind, label, upi_id, account_name, account_number, ifsc, is_default, created_at, rzp_contact_id, rzp_fund_account_id";
export const PROMOTION_SELECT =
  "id, task_id, user_id, amount_minor, days, status, payment_id, starts_at, ends_at, created_at, updated_at, audience, settled_at";
export const NOTIFICATION_SELECT = "id, user_id, kind, title, body, task_id, ticket_id, read_at, created_at";
export const SUPPORT_TICKET_SELECT = "id, user_id, category, subject, page, status, created_at, updated_at";
