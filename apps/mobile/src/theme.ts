/**
 * TaskDrop theme tokens — extracted from the design canvas palette.
 * Brand accent is a cool jade green (#0E8F72 light / #2FBF96 dark) —
 * deliberately cooler and deeper than the brighter grass-green marketplace
 * incumbents (Fiverr, Upwork) use, while staying clearly a green; gold =
 * verified-badge; signal = warnings/cancel; purple = the worker (Earn) side,
 * now a royal blue despite the name, plus promotions/ads; ai = the AI
 * assistant (sparkle, credits), kept violet so it stays its own thing.
 * Light + dark are role-consistent.
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
  ai: string;
  blue: string;
  onAccent: string;
};

export const light: Palette = {
  bg: '#F1F1F1',
  surface: '#FFFFFF',
  surface2: '#F7F7F7',
  line: '#E4E4E4',
  ink: '#16171A',
  text: '#4A4A4A',
  muted: '#8A8A8A',
  accent: '#0E8F72',
  accentDeep: '#0A6F58',
  accentSoft: '#E9F6F1',
  accentBorder: '#BFE3D5',
  gold: '#E0A85A',
  goldSoft: '#F0DEBB',
  goldInk: '#8A5A12',
  signal: '#E0724A',
  signalDeep: '#B4512C',
  signalSoft: '#FBEDE7',
  purple: '#2F5BEA',
  purpleDeep: '#1E40AF',
  ai: '#7F77DD',
  blue: '#4A90D9',
  onAccent: '#FFFFFF',
};

export const dark: Palette = {
  bg: '#0F1012',
  surface: '#16171A',
  surface2: '#1F1F1F',
  line: '#2A2B2F',
  ink: '#F1F1F1',
  text: '#D6D6D6',
  muted: '#8A8A8A',
  accent: '#2FBF96',
  accentDeep: '#57D1AE',
  accentSoft: '#12271F',
  accentBorder: '#1E3A30',
  gold: '#E0A85A',
  goldSoft: '#2C2413',
  goldInk: '#E7C784',
  signal: '#E0724A',
  signalDeep: '#F0906B',
  signalSoft: '#2A1A13',
  purple: '#6B8CFF',
  purpleDeep: '#4F6FE8',
  ai: '#8A82E6',
  blue: '#5AA0E6',
  onAccent: '#04140D',
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

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const typography = {
  display: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5 },
  h1: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.4 },
  h2: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  mono: { fontSize: 12, fontWeight: '600' as const },
} as const;

export type Theme = {
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  isDark: boolean;
};

export function makeTheme(isDark: boolean): Theme {
  return { colors: isDark ? dark : light, spacing, radius, typography, isDark };
}
