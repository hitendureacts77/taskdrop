import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';

/**
 * A sideways row of cards that actually scrolls everywhere. Fingers swipe it
 * on a phone; with a mouse (the web build) there is nothing to swipe, so
 * arrow buttons page it left and right, and hide at either end.
 */
export function Rail({ children, step = 260 }: { children: React.ReactNode; step?: number }) {
  const t = useTheme();
  const ref = useRef<ScrollView>(null);
  const [x, setX] = useState(0);
  const [viewW, setViewW] = useState(0);
  const [contentW, setContentW] = useState(0);
  const max = Math.max(0, contentW - viewW);
  const web = Platform.OS === 'web';

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
      >
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>{children}</View>
      </ScrollView>
      {web && x > 8 ? arrow(-1) : null}
      {web && x < max - 8 ? arrow(1) : null}
    </View>
  );
}
