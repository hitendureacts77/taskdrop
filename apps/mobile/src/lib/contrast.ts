/**
 * WCAG contrast between two colours, for the tests that hold the "white text only on the deep shades"
 * rule (4.5:1). Pure, no React Native, tested in Node (contrast.test.ts).
 */

type Rgb = [number, number, number];

/** "#RRGGBB" or "rgba(r,g,b,a)" to its channels and alpha. */
export function parseColour(c: string): { rgb: Rgb; a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const v = hex[1]!;
    return { rgb: [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb, a: 1 };
  }
  const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c.trim());
  if (fn) return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], a: fn[4] === undefined ? 1 : Number(fn[4]) };
  throw new Error(`Not a colour: ${c}`);
}

/** A see-through colour laid over a solid one, as the eye sees it. */
export function over(top: string, under: string): Rgb {
  const t = parseColour(top);
  const u = parseColour(under).rgb;
  return t.rgb.map((v, i) => Math.round(v * t.a + u[i]! * (1 - t.a))) as Rgb;
}

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The contrast ratio, 1 to 21. A see-through text colour is first laid over the background. */
export function contrastRatio(fg: string | Rgb, bg: string | Rgb): number {
  const b = typeof bg === 'string' ? over(bg, '#FFFFFF') : bg;
  const f = typeof fg === 'string' ? over(fg, `rgb(${b.join(',')})`) : fg;
  const x = luminance(f);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
