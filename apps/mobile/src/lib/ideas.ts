/**
 * The feedback board (migration 136): the words and the small rules the app
 * keeps for it. The server owns the real ones (who may post, how often, what is
 * refused); this file only labels what the server sends and updates a vote on
 * screen before the server has answered.
 */

export type IdeaStatus = 'open' | 'under_review' | 'planned' | 'in_progress' | 'done' | 'declined';
export type IdeaKind = 'feature' | 'improvement' | 'bug' | 'other';
export type IdeaTone = 'accent' | 'gold' | 'blue' | 'purple' | 'neutral';

export type Idea = {
  id: string;
  title: string;
  body: string;
  category: IdeaKind;
  status: IdeaStatus;
  votes: number;
  comments: number;
  iVoted: boolean;
  mine: boolean;
  /** A first name, "Someone", never more. */
  author: string;
  createdAt: string;
  statusChangedAt: string;
};

export type IdeaComment = {
  id: string;
  body: string;
  isTeam: boolean;
  author: string;
  mine: boolean;
  createdAt: string;
};

export const STATUS_LABEL: Record<IdeaStatus, string> = {
  open: 'Open',
  under_review: 'Under review',
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  declined: 'Not planned',
};

export const STATUS_TONE: Record<IdeaStatus, IdeaTone> = {
  open: 'neutral',
  under_review: 'gold',
  planned: 'purple',
  in_progress: 'blue',
  done: 'accent',
  declined: 'neutral',
};

/** The filter pills on the board; null is "everything". */
export const STATUS_FILTERS: { key: IdeaStatus | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'under_review', label: 'Under review' },
  { key: 'planned', label: 'Planned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

export const KIND_LABEL: Record<IdeaKind, string> = {
  feature: 'New feature',
  improvement: 'Improvement',
  bug: 'Bug',
  other: 'Other',
};

export const KINDS: IdeaKind[] = ['feature', 'improvement', 'bug', 'other'];

/** The idea with a vote added or taken back, as the server will count it. Same state in, same idea out. */
export function withVote(idea: Idea, on: boolean): Idea {
  if (idea.iVoted === on) return idea;
  return { ...idea, iVoted: on, votes: Math.max(0, idea.votes + (on ? 1 : -1)) };
}

/** The server's count after a vote, applied over whatever the screen guessed. */
export function withVoteResult(idea: Idea, result: { votes: number; iVoted: boolean }): Idea {
  return { ...idea, votes: result.votes, iVoted: result.iVoted };
}

/**
 * What to search for while someone types a title, so they see an idea that is
 * already there before they post a copy of it: the longest word of four letters
 * or more. Null while there is nothing worth searching.
 */
export function similarQuery(title: string): string | null {
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);
  if (words.length === 0) return null;
  return words.reduce((best, w) => (w.length > best.length ? w : best));
}

/** "1", "12", "1.2k": the vote count in the little box. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  return `${k}k`;
}
