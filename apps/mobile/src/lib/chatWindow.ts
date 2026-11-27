/** The chat window (task 1.19 row B): what the server says about whether a task's chat may be written to. */
export type ChatState = {
  taskId: string;
  open: boolean;
  state: 'open' | 'closing' | 'closed';
  reason: null | 'not_participant' | 'not_locked' | 'cancelled' | 'window_ended';
  message: string | null;
  closesAt: string | null;
  deleteAfter: string | null;
};

/** "1 day 4 h", "3 h", "25 min": how long until `iso`, in plain words; "a moment" when it is about now or past. */
export function timeUntil(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms < 60_000) return 'a moment';
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'}${hours ? ` ${hours} h` : ''}`;
  if (hours > 0) return `${hours} h`;
  return `${mins} min`;
}

/** The small line under the thread while the chat is still open but about to close. */
export function closingLine(closesAt: string | null, now: number = Date.now()): string {
  return closesAt
    ? `Chat closes in ${timeUntil(closesAt, now)}. Messages are deleted after that.`
    : 'Chat closes soon. Messages are deleted after that.';
}
