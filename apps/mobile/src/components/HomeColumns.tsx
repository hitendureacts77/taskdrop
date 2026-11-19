import React from 'react';
import { View } from 'react-native';
import { CARD_MIN, useLayout, type Layout } from '../lib/layout';

/**
 * Desktop Home in two columns (docs/design/desktop-web/PLAN.md, package 9): the feed sections on the left
 * and a 320 wide side column ("Your day") on the right with the small items Home already has. Desktop only:
 * phones and tablets never render this, HomeSections keeps their one column exactly as before.
 */

/** The side column's width, in layout px. */
export const HOME_SIDE_WIDTH = 320;
/** Space between the main column's own 20 px padding and the side column. */
const SIDE_GAP = 4;
/** The right edge padding, the same 20 the sections use. */
const EDGE = 20;

/**
 * Whether Home is in two columns, and how many cards fit side by side in the main column. Off desktop it
 * is one column and the layout's own count, so nothing changes there.
 */
export function useHomeColumns(): { two: boolean; mainColumns: Layout['columns']; mainWidth: number } {
  const { desktop, contentWidth, columns } = useLayout();
  if (!desktop) return { two: false, mainColumns: columns, mainWidth: contentWidth('feed') };
  // The same measure useLayout uses for the whole feed, on what is left beside the side column.
  const main = contentWidth('feed') - HOME_SIDE_WIDTH - SIDE_GAP - EDGE;
  const fit = Math.floor((main + 16) / (CARD_MIN + 16));
  return { two: true, mainColumns: Math.min(4, Math.max(1, fit)) as Layout['columns'], mainWidth: main };
}

/** The two columns: `main` grows, `side` is 320 wide. Each section keeps its own padding. */
export function HomeColumns({ main, side }: { main: React.ReactNode; side: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <View style={{ flex: 1, minWidth: 0 }}>{main}</View>
      <View style={{ width: HOME_SIDE_WIDTH, marginLeft: SIDE_GAP, marginRight: EDGE, paddingTop: 4 }}>{side}</View>
    </View>
  );
}

/**
 * kit's Grid with the column count given, because Grid counts columns for the whole window and the main
 * column is narrower. Same markup and the same `fill` rule (a short list spreads over the row).
 */
export function ColumnsGrid({
  children,
  columns: fit,
  gap = 14,
  fill = false,
}: {
  children: React.ReactNode;
  columns: number;
  gap?: number;
  fill?: boolean;
}) {
  if (fit === 1) return <>{children}</>;
  const items = React.Children.toArray(children);
  const columns = fill ? Math.min(fit, Math.max(2, items.length)) : fit;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {items.map((child, i) => (
        <View
          key={React.isValidElement(child) && child.key != null ? child.key : i}
          style={{ width: `${100 / columns}%`, paddingHorizontal: gap / 2 }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}
