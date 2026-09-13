import React from 'react';
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
  | 'chat';

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
