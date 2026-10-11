/**
 * TaskDrop theme tokens — design system v2 (Taskdrop version 2.0 redesign,
 * SYS-Foundations). Jade means hiring and protected money; royal blue means
 * earning (the Earn side swaps the accent set, see RoleTheme); violet is the
 * AI writer and the remote tag; gold is verified and levels; coral is late,
 * problems and urgent. Light and dark are both first-class and role-consistent.
 *
 * The names are the app's original ones (purple is the Earn blue, signal is
 * coral) so every screen keeps reading the same keys.
 */
export type Palette = {
  bg: string;
  surface: string;
  surface2: string;
  line: string;
  ink: string; // headings / strong text
  text: string; // body
  muted: string; // secondary
  accent: string;
  accentDeep: string;
  accentSoft: string;
  accentBorder: string;
  gold: string;
  goldSoft: string;
  goldInk: string;
  signal: string;
  signalDeep: string;
  signalSoft: string;
  purple: string;
  purpleDeep: string;
  /** Earn-blue tinted background, for "remote"/earn tags on either side. */
  purpleSoft: string;
  ai: string;
  /** AI-violet tinted background and its readable ink. */
  aiSoft: string;
  aiInk: string;
  blue: string;
  onAccent: string;
  /** Background for big cards with white text (balances, summaries): dark enough in both themes. */
  hero: string;
  /** The three stops of the diagonal hero gradient (light → deep). */
  heroFrom: string;
  heroMid: string;
  heroTo: string;
  /** Filled buttons: deep jade in light (6.1:1 with white), jade in dark (with ink text). */
  btn: string;
  onBtn: string;
  /** Presence: "Active now". */
  online: string;
  /** Soft drop shadow colour for cards in light; dark uses borders only. */
  shadow: string;
};

export const light: Palette = {
  bg: '#F3F4F1',
  surface: '#FFFFFF',
  surface2: '#ECEEE9',
  line: '#E2E5DF',
  ink: '#121417',
  text: '#3F444A',
  muted: '#5F6368',
  accent: '#0E8F72',
  accentDeep: '#0A6F58',
  accentSoft: '#E7F5EF',
  accentBorder: '#BFE3D5',
  gold: '#E0A85A',
  goldSoft: '#FBF1E0',
  goldInk: '#8A5A12',
  signal: '#E0724A',
  signalDeep: '#B4512C',
  signalSoft: '#FBEDE7',
  purple: '#2F5BEA',
  purpleDeep: '#1E40AF',
  purpleSoft: '#EAF0FE',
  ai: '#7F77DD',
  aiSoft: '#F0EFFC',
  aiInk: '#5148C2',
  blue: '#4A90D9',
  onAccent: '#FFFFFF',
  hero: '#0A6F58',
  heroFrom: '#0D8A6F',
  heroMid: '#0A6F58',
  heroTo: '#064A3B',
  btn: '#0A6F58',
  onBtn: '#FFFFFF',
  online: '#12804A',
  shadow: '#121417',
};

export const dark: Palette = {
  bg: '#0E1012',
  surface: '#16191C',
  surface2: '#1E2226',
  line: '#2A2F34',
  ink: '#F2F3F1',
  text: '#C9CDD2',
  muted: '#9AA0A6',
  accent: '#2FBF96',
  accentDeep: '#57D1AE',
  accentSoft: '#12271F',
  accentBorder: '#1E3A30',
  gold: '#E0A85A',
  goldSoft: '#2A2216',
  goldInk: '#E8BE80',
  signal: '#E0724A',
  signalDeep: '#F08A66',
  signalSoft: '#2C1A14',
  purple: '#6B8CFF',
  purpleDeep: '#4F6FE8',
  purpleSoft: '#172036',
  ai: '#A39CF0',
  aiSoft: '#1E1C33',
  aiInk: '#A9A3F2',
  blue: '#5AA0E6',
  onAccent: '#04140D',
  hero: '#0B5E4B',
  heroFrom: '#0E8F72',
  heroMid: '#0B5E4B',
  heroTo: '#06372C',
  btn: '#2FBF96',
  onBtn: '#04140D',
  online: '#4ADE9A',
  shadow: '#000000',
};

/** Plus Jakarta Sans families (from @expo-google-fonts/plus-jakarta-sans).
 *  RN needs a distinct family per weight rather than a numeric fontWeight. */
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export function fontFamilyFor(weight?: string): string {
  switch (weight) {
    case '900':
    case '800':
      return fonts.extrabold;
    case '700':
      return fonts.bold;
    case '600':
      return fonts.semibold;
    case '500':
      return fonts.medium;
    default:
      return fonts.regular;
  }
}

/** Space scale: 4 · 8 · 12 · 16 · 20 · 24 · 32. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, gutter: 20, xl: 24, xxl: 32 } as const;
/** Radius scale: 8 tag · 14 input · 18 card · 22 hero · 26 sheet · pill. */
export const radius = { sm: 8, md: 14, lg: 18, xl: 22, sheet: 26, pill: 999 } as const;

export const typography = {
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -1 },
  h1: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.7 },
  h2: { fontSize: 18, fontWeight: '800' as const, letterSpacing: -0.35 },
  h3: { fontSize: 15, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  mono: { fontSize: 12, fontWeight: '600' as const },
} as const;

/**
 * Motion tokens (SYS-Motion). Exits are faster than entrances; loops only run
 * while something is genuinely live. Everything respects Reduce Motion (see
 * lib/motion.ts).
 */
export const motion = {
  press: 120,
  pressScale: 0.97,
  ui: 250,
  push: 360,
  pushDistance: 24,
  sheetIn: 380,
  sheetOut: 220,
  stagger: 60,
  staggerMax: 6,
  celebrate: 1200,
  /** Spring for chips, toggles and selected cards (≈ cubic-bezier(.34,1.56,.64,1)). */
  spring: { friction: 6, tension: 160 },
} as const;

export type Theme = {
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  motion: typeof motion;
  isDark: boolean;
};

export function makeTheme(isDark: boolean): Theme {
  return { colors: isDark ? dark : light, spacing, radius, typography, motion, isDark };
}
