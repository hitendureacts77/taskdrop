/**
 * One offer per worker per task (plan: one offer, edit until picked).
 *
 * The pure part: which button and which sentence a worker sees for a task, given what the app already
 * knows. The server decides everything that matters (the unique index, the edit-while-open trigger); this
 * only keeps the buttons honest. Tested in Node (offerState.test.ts), so no React or React Native here.
 */

export type OfferState = 'send' | 'edit' | 'accepted' | 'closed' | 'own' | 'hunt';

export type OfferInput = {
  /** The task is the viewer's own request. */
  isOwn: boolean;
  /** The task is a City Hunt: finders send finds, not offers. */
  isHunt: boolean;
  /** The task is still OPEN for offers. */
  taskOpen: boolean;
  /** The viewer's existing offer on this task, if any. */
  bid: { is_locked: boolean } | null;
};

/** Checked in order: own, hunt, accepted, edit, closed, send. */
export function offerState({ isOwn, isHunt, taskOpen, bid }: OfferInput): OfferState {
  if (isOwn) return 'own';
  if (isHunt) return 'hunt';
  if (bid?.is_locked) return 'accepted';
  if (bid && taskOpen) return 'edit';
  if (!taskOpen) return 'closed';
  return 'send';
}

export type OfferCopyEntry = {
  /** The button text; null when there is nothing to press. */
  button: string | null;
  note: string;
};

export const OFFER_COPY: Record<OfferState, OfferCopyEntry> = {
  send: {
    button: 'Send offer',
    note: 'You can send one offer for this task. You can edit it later, until the customer picks someone.',
  },
  edit: {
    button: 'Edit your offer',
    note: 'You already sent an offer. Change it here. You cannot send a second one.',
  },
  accepted: {
    button: null,
    note: 'The customer accepted your offer, so it can no longer be changed.',
  },
  closed: {
    button: 'Find another request',
    note: 'This request is no longer open for offers.',
  },
  hunt: {
    button: 'I’m looking',
    note: 'This is a Hunt: send a find instead of an offer.',
  },
  own: {
    button: null,
    note: 'This is your own request.',
  },
};

/** The server refused a second offer on the same task (code DUPLICATE, or the old unique-index wording). */
export function isDuplicateOfferError(e: unknown): boolean {
  if ((e as { code?: unknown } | null | undefined)?.code === 'DUPLICATE') return true;
  const message = e instanceof Error ? e.message : (e as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && /already sent an offer|duplicate|unique/i.test(message);
}
