/** The part of an offer row the poster's pick needs. */
export type PickableOffer = { bidId?: string; who: string };

/** What identifies an offer row: its bid id, or the name for a sample row that has none. */
export function offerKey(row: PickableOffer): string {
  return row.bidId ?? row.who;
}

/**
 * The offer the poster has picked. Two workers can share a display name, so
 * the pick is matched on the bid id (the name only for sample rows without
 * one). Nothing picked, or a pick that is no longer in the list, falls back
 * to the first row.
 */
export function pickOffer<T extends PickableOffer>(rows: readonly T[], pickedId: string | null): T | undefined {
  if (pickedId !== null) {
    const match = rows.find((r) => offerKey(r) === pickedId);
    if (match) return match;
  }
  return rows[0];
}
