/**
 * A theme colour with some see-through added, so a frosted bar follows the theme's own `surface` instead of a
 * hand-copied rgba (THEME_AUDIT row 27). Takes '#RGB' or '#RRGGBB'; anything else comes back unchanged.
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1]!;
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
