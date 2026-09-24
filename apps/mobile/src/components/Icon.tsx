import Svg, { Path, Circle } from 'react-native-svg';

/**
 * SVG icon set — paths taken from the design (renderVals ICON map + markup).
 * Stroked (outline) icons match the design's line style; a few are filled.
 */
export type IconName =
  | 'home'
  | 'search'
  | 'orders'
  | 'wallet'
  | 'user'
  | 'check'
  | 'star'
  | 'chevronRight'
  | 'back'
  | 'plus'
  | 'minus'
  | 'play'
  | 'share'
  | 'lock'
  | 'phone'
  | 'chat'
  | 'bell'
  | 'bookmark'
  | 'sparkle'
  | 'mic'
  | 'menu'
  | 'dots'
  | 'settings'
  | 'help'
  | 'flag'
  | 'gift'
  | 'trending'
  | 'bolt'
  | 'trophy'
  | 'filter'
  | 'close'
  | 'eye'
  | 'clock'
  | 'pin'
  | 'shield'
  | 'logout'
  | 'send'
  | 'tag'
  | 'compass'
  | 'briefcase'
  | 'list'
  | 'refresh'
  | 'card'
  | 'gavel'
  | 'copy'
  | 'edit'
  | 'users'
  | 'live';

const STROKE: Partial<Record<IconName, string>> = {
  home: 'M4 10.6 12 4l8 6.6V20h-5v-6H9v6H4v-9.4Z',
  orders: 'M9 3.6h6v2.8H9zM6.4 5h11.2v15.4H6.4M9.6 11h5M9.6 15h5',
  wallet: 'M3.5 7.5h17v11h-17zM3.5 10.5h17M16 14h2',
  user: 'M6.3 18.8a6 6 0 0 1 11.4 0',
  check: 'M5 12.5l4 4L19 7',
  chevronRight: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  share: 'M12 15V4M8 7l4-4 4 4M5 12v7h14v-7',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2M5.5 10h13v9h-13z',
  phone: 'M6 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 5 6a2 2 0 0 1 1-2Z',
  chat: 'M4 5h16v11H8l-4 4V5Z',
  // Circles are written as two arcs so every stroked icon stays a single path.
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0',
  bookmark: 'M6.5 4h11v16l-5.5-4-5.5 4V4Z',
  sparkle: 'M12 3.5l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9L12 3.5ZM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z',
  mic: 'M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0V6ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  menu: 'M4 7h16M4 12h16M4 17h16',
  dots: 'M11 5.5a1 1 0 1 0 2 0 1 1 0 1 0-2 0M11 12a1 1 0 1 0 2 0 1 1 0 1 0-2 0M11 18.5a1 1 0 1 0 2 0 1 1 0 1 0-2 0',
  settings:
    'M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7',
  help: 'M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0M9.6 9.4a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.4M12 17h.01',
  flag: 'M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11',
  gift: 'M4 10h16v3.5H4zM5.5 13.5V20h13v-6.5M12 10v10M12 10c-1.5-3.5-5.5-4-5.5-1.5S12 10 12 10Zm0 0c1.5-3.5 5.5-4 5.5-1.5S12 10 12 10Z',
  trending: 'M3.5 17 9.5 11l3.5 3.5L20.5 7M15 7h5.5v5.5',
  bolt: 'M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4.5a3 3 0 0 0 3.8 4.3M16 6h3.5a3 3 0 0 1-3.8 4.3M12 13v4M8.5 20h7M9.5 17h5',
  filter: 'M4 6h16M7 12h10M10 18h4',
  close: 'M6 6l12 12M18 6 6 18',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12ZM9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0',
  clock: 'M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0M12 7.5V12l3 2',
  pin: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11ZM9.8 10a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0',
  shield: 'M12 3 5 6v5.5c0 4.5 3 7.8 7 9.5 4-1.7 7-5 7-9.5V6l-7-3ZM9 12l2 2 4-4',
  logout: 'M14 4.5h4.5v15H14M10 8l-4 4 4 4M6 12h9.5',
  send: 'M20.5 3.5 3.5 10.5l7 2.5 2.5 7 7.5-16.5ZM10.5 13l4-4',
  tag: 'M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5-8.5-8.5ZM7.5 8h.01',
  compass: 'M3.5 12a8.5 8.5 0 1 0 17 0 8.5 8.5 0 1 0-17 0M15.5 8.5l-2 5-5 2 2-5 5-2Z',
  briefcase: 'M3.5 8h17v11h-17zM9 8V5.5h6V8M3.5 13h17',
  list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  refresh: 'M19.5 11A7.5 7.5 0 0 0 6 7.5L4.5 9M4.5 13a7.5 7.5 0 0 0 13.5 3.5l1.5-1.5M4.5 4.5V9H9M19.5 19.5V15H15',
  card: 'M3.5 6h17v12h-17zM3.5 10h17M7 14.5h4',
  gavel: 'M13.5 4.5l6 6M11 7l6 6M15.5 8.5 9 15M4 20l6.5-6.5M4 20h7',
  copy: 'M8.5 8.5h11v11h-11zM15.5 8.5V4.5h-11v11h4',
  edit: 'M4.5 19.5h4l10-10-4-4-10 10v4ZM13 7l4 4',
  users: 'M5.5 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0M2.5 19a6 6 0 0 1 12 0M15 5.5a3 3 0 0 1 0 5.5M17.5 13.5a6 6 0 0 1 4 5.5',
  live: 'M9.5 12a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M6.5 6.5a8 8 0 0 0 0 11M17.5 6.5a8 8 0 0 1 0 11',
};

const FILLED: Partial<Record<IconName, string>> = {
  star: 'M12 3.2l2.5 5.4 5.9.6-4.4 4 1.2 5.8L12 16.9 6.8 19l1.2-5.8-4.4-4 5.9-.6L12 3.2Z',
  play: 'M8 5v14l11-7z',
};

export function Icon({
  name,
  size = 22,
  color = '#000',
  strokeWidth = 1.9,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  if (name === 'search') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={strokeWidth} />
        <Path d="m16.5 16.5 4 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </Svg>
    );
  }
  if (name === 'user') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={8.6} r={3} stroke={color} strokeWidth={strokeWidth} />
        <Path d={STROKE.user} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      </Svg>
    );
  }
  const filled = FILLED[name];
  if (filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path d={filled} />
      </Svg>
    );
  }
  const d = STROKE[name];
  if (!d) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={d}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
