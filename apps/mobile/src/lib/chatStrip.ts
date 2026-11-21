/**
 * The money line under the task title in a chat. It follows the task's status: money is only "held" while
 * something is held (S6-43). `amount` and `earns` are already formatted ("Rs 500").
 */
export function chatMoneyLine(
  status: string | null,
  held: { amount: string; earns: string } | null,
  iAmPoster: boolean | null,
): string {
  if (status === 'CANCELLED') return 'This task was cancelled';
  if (status === 'COMPLETED' || status === 'AUTO_COMPLETED') {
    if (!held) return 'This task is finished';
    return iAmPoster === false ? `${held.earns} released to you` : `${held.amount} released to the worker`;
  }
  if (!held) return 'Open the task for payment details';
  if (status === 'DISPUTED') return `${held.amount} · held while the team looks`;
  return iAmPoster === false ? `You earn ${held.earns} · held safely` : `${held.amount} · held safely`;
}
