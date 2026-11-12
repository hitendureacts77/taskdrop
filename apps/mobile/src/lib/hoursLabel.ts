/** "1 hr", "2 hrs": the time an offer says it needs, never less than one hour and never "1 hrs". */
export function hoursLabel(minutes: number): string {
  const h = Math.max(1, Math.round((Number(minutes) || 0) / 60));
  return h + (h === 1 ? ' hr' : ' hrs');
}
