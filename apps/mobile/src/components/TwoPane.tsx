import React from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLayout } from '../lib/layout';

/**
 * Two panes side by side on a wide desktop (docs/design/desktop-fit/PLAN.md, Q3):
 * Task detail, Profile, Settings. One pane has a fixed width, the other takes
 * the rest of the feed column, `gutter` apart, so together they fill the column
 * edge to edge. Each pane scrolls on its own, so the short one (the offer, the
 * tabs) stays in view while the long one scrolls: that is what `position:
 * sticky` would give, without a shared scroll to stick in. Each pane is at most
 * the screen's height, so its last control is always reachable (Q6).
 *
 * Only when `useLayout().twoPane` (desktop, feed column ≥ 940). Otherwise, and
 * on every tablet, phone and native app, it renders `single`: the screen's own
 * one-column layout, exactly as before.
 */
export function TwoPane({
  left,
  right,
  fixed = 'left',
  width,
  single,
  singleContent,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Which pane has the fixed width; the other one grows. */
  fixed?: 'left' | 'right';
  /** The fixed pane's width, in design px. */
  width: number;
  /**
   * The one-column layout, used whenever two panes do not fit. Left out, it is
   * one ScrollView with `left` then `right` in it (`singleContent` its content style).
   */
  single?: React.ReactNode;
  singleContent?: StyleProp<ViewStyle>;
}) {
  const { twoPane, gutter } = useLayout();
  if (!twoPane) {
    if (single !== undefined) return <>{single}</>;
    return (
      <ScrollView contentContainerStyle={singleContent}>
        {left}
        {right}
      </ScrollView>
    );
  }
  const pane = (content: React.ReactNode, isFixed: boolean, label: string) => (
    <View
      key={label}
      nativeID={`twoPane-${label}`}
      style={isFixed ? { width, flexShrink: 0, maxHeight: '100%' } : { flex: 1, minWidth: 0, maxHeight: '100%' }}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 28 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {content}
      </ScrollView>
    </View>
  );
  return (
    <View nativeID="twoPane" style={{ flex: 1, flexDirection: 'row', gap: gutter, minHeight: 0 }}>
      {pane(left, fixed === 'left', 'left')}
      {pane(right, fixed === 'right', 'right')}
    </View>
  );
}
