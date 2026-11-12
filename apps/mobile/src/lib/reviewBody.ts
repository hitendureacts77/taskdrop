/** Most characters a review comment can hold. The server caps the whole body at 2000, and praise tags are appended. */
export const REVIEW_COMMENT_MAX = 1800;

/** Praise tags only go with a good review: 4 or 5 stars. */
export function praiseAllowed(stars: number): boolean {
  return stars >= 4;
}

/**
 * The text sent with a review: the comment, then the praise the poster ticked.
 * At 3 stars or fewer the tags are left out, so a poor rating never carries
 * "On time" or "Great communication".
 */
export function reviewBody(stars: number, tags: readonly string[], comment: string): string {
  const text = comment.trim();
  const praise = praiseAllowed(stars) ? tags.filter((t) => t.trim() !== '') : [];
  if (praise.length === 0) return text;
  return [text, praise.join(' · ')].filter(Boolean).join('\n');
}
