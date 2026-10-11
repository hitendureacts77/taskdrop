import React, { createContext, useContext, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useLayout } from '../lib/layout';
import { Icon } from './Icon';

/** The width a card inside a Rail should take, or undefined for its own. */
const RailWidth = createContext<number | undefined>(undefined);

/**
 * A card's width inside a Rail: its own fixed width on a phone, where the
 * rail scrolls sideways; the grid column's width on wider screens.
 */
export function useRailItemWidth(own: number): number {
  return useContext(RailWidth) ?? own;
}

/**
 * A sideways row of cards that actually scrolls everywhere. Fingers swipe it
 * on a phone; with a mouse (the web build) there is nothing to swipe, so
 * arrow buttons page it left and right, and hide at either end.
 *
 * On tablet and desktop widths (v2) the rail becomes a wrapping grid of
 * columns at least `min` wide, in the same order -- nothing hides off-screen.
 */
export function Rail({ children, step = 260, min = 170 }: { children: React.ReactNode; step?: number; min?: number }) {
  const t = useTheme();
  const { desktop, tablet } = useLayout();
  const ref = useRef<ScrollView>(null);
  const [x, setX] = useState(0);
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const max = Math.max(0, contentW - viewW);
  const web = Platform.OS === 'web';

  if (desktop || tablet) {
    const gap = 12;
    const cols = viewW > 0 ? Math.max(1, Math.floor((viewW + gap) / (min + gap))) : 1;
    const itemW = viewW > 0 ? Math.floor((viewW - gap * (cols - 1)) / cols) : min;
    return (
      <View onLayout={(e) => setViewW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {viewW > 0 ? <RailWidth.Provider value={itemW}>{children}</RailWidth.Provider> : null}
      </View>
    );
  }

  const page = (dir: 1 | -1) => ref.current?.scrollTo({ x: Math.max(0, Math.min(max, x + dir * step)), animated: true });

  const arrow = (dir: 1 | -1) => (
    <Pressable
      onPress={() => page(dir)}
      accessibilityRole="button"
      accessibilityLabel={dir === 1 ? 'Scroll right' : 'Scroll left'}
      style={({ pressed }) => ({
        position: 'absolute',
        top: '50%',
        [dir === 1 ? 'right' : 'left']: 6,
        marginTop: -17,
        width: 34,
        height: 34,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ transform: [{ rotate: dir === 1 ? '0deg' : '180deg' }] }}>
        <Icon name="chevronRight" size={16} color={t.colors.ink} />
      </View>
    </Pressable>
  );

  return (
    <View style={{ marginHorizontal: -20 }}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => setX(e.nativeEvent.contentOffset.x)}
        onContentSizeChange={(w) => setContentW(w)}
        onLayout={(e) => setViewW(e.nativeEvent.layout.width)}
        // Cards settle at the start of a card, like the design's scroll-snap.
        decelerationRate="fast"
      >
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 }}>{children}</View>
      </ScrollView>
      {web && x > 8 ? arrow(-1) : null}
      {web && x < max - 8 ? arrow(1) : null}
    </View>
  );
}
