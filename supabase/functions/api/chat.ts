import { type Ctx, OpError } from "./core.ts";

/**
 * The chat window (plan task 1.19 row B, migration 215). Two people chat only while a task is locked
 * between them, and for 48 hours after it is completed; then the messages are deleted. The database
 * decides (public.task_chat_states, and the messages insert policy); this turns its answer into what
 * the app shows.
 */

export const CHAT_CLOSED = "CHAT_CLOSED";

export type ChatReason = "not_participant" | "not_locked" | "cancelled" | "window_ended";

/** What the app gets for one task: `chatState`, and `chat` on every listThreads row. */
export type ChatState = {
  taskId: string;
  /** Whether the caller may send now. */
  open: boolean;
  /** 'open' = task live; 'closing' = completed, still inside the 48 hours; 'closed'. */
  state: "open" | "closing" | "closed";
  /** Why it is closed; null while open or closing. */
  reason: ChatReason | null;
  /** A sentence for the notice above the message box; null while the task is live. */
  message: string | null;
  /** 'closing': when sending stops. 'closed' after a finished task: when it stopped. ISO time or null. */
  closesAt: string | null;
  /** The earliest time the messages may be deleted (finished tasks only). ISO time or null. */
  deleteAfter: string | null;
};

export const CHAT_REASON_TEXT: Record<ChatReason, string> = {
  not_participant: "Only the poster and the hired helper can chat on this task.",
  not_locked: "Chat opens once this task is locked with a helper.",
  cancelled: "This task was cancelled, so the chat is closed.",
  window_ended: "This chat closed 2 days after the task was completed. Its messages are deleted soon after.",
};

export const CHAT_CLOSING_TEXT = "Task completed. You can keep chatting for 2 days after completion, then the chat closes and its messages are deleted.";

type Row = { task_id: string; state: string; can_send: boolean; reason: string | null; closes_at: string | null; delete_after: string | null };

const REASONS = new Set<string>(Object.keys(CHAT_REASON_TEXT));
const STATES = new Set<string>(["open", "closing", "closed"]);

export function chatStateFrom(r: Row): ChatState {
  const state = r.state === "open" || r.state === "closing" ? r.state : "closed";
  const reason = r.reason && REASONS.has(r.reason) ? (r.reason as ChatReason) : state === "closed" ? "not_participant" : null;
  return {
    taskId: r.task_id,
    open: r.can_send === true && state !== "closed",
    state,
    reason: state === "closed" ? reason : null,
    message: state === "closed" ? CHAT_REASON_TEXT[reason ?? "not_participant"] : state === "closing" ? CHAT_CLOSING_TEXT : null,
    closesAt: r.closes_at ?? null,
    deleteAfter: r.delete_after ?? null,
  };
}

/**
 * The caller's chat state for each task id, keyed by id. A task the database did not answer for
 * is missing from the map; `quiet` turns a failed read into an empty map (listThreads must not fail
 * because of it).
 */
export async function readChatStates(ctx: Ctx, ids: string[], quiet = false): Promise<Map<string, ChatState>> {
  const out = new Map<string, ChatState>();
  if (ids.length === 0) return out;
  const res = await ctx.db.rpc("task_chat_states", { p_task_ids: ids });
  if (res.error) {
    if (quiet) return out;
    throw new OpError("Could not check this chat. Please try again.", "DB_ERROR");
  }
  const list = Array.isArray(res.data) ? (res.data as Row[]) : [];
  // Only a well-formed answer counts; anything else is "no answer" and the insert policy decides.
  for (const r of list) {
    if (r && typeof r.task_id === "string" && STATES.has(r.state) && typeof r.can_send === "boolean") out.set(r.task_id, chatStateFrom(r));
  }
  return out;
}

/** Refuses a send outside the window with CHAT_CLOSED and the plain reason. The insert policy refuses it too. */
export async function assertChatOpen(ctx: Ctx, taskId: string): Promise<void> {
  const s = (await readChatStates(ctx, [taskId])).get(taskId);
  if (s && !s.open) throw new OpError(s.message ?? CHAT_REASON_TEXT.not_participant, CHAT_CLOSED, s.reason);
}
