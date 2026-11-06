/**
 * Did Razorpay collect exactly what TaskDrop asked for? (task 2.18 part E, hole H76.)
 *
 * The payment link is made by the server with the amount on record, and the message saying it was
 * paid is signed, so this is a second net, not the first. Both places that can settle a payment
 * ask it before anything is marked paid: the webhook and the app's own check. A missing or odd
 * figure counts as "no": a payment held for a person to look at can be put right, money handed
 * out on a wrong figure cannot.
 *
 * Both figures are in the smallest unit (paise), which is what `amount_minor` stores and what
 * Razorpay reports.
 */
export function paidAmountMatches(expectedMinor: unknown, reportedMinor: unknown): boolean {
  if (typeof reportedMinor !== "number" && typeof reportedMinor !== "string") return false;
  if (typeof reportedMinor === "string" && reportedMinor.trim() === "") return false;
  const expected = Number(expectedMinor);
  const reported = Number(reportedMinor);
  return Number.isSafeInteger(expected) && expected > 0 && reported === expected;
}
