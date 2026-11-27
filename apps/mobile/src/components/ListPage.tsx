import React from 'react';
import { Pressable, ScrollView, Text, View, type ScrollViewProps, type ViewStyle } from 'react-native';
import { useLayout } from '../lib/layout';
import { useTheme } from '../providers/ThemeProvider';
import { Pill } from './kit';
import { tx } from './primitives';

/** The widest the desktop list page gets (docs/design/desktop-web/PLAN.md, 4.2 c). */
export const LIST_MAX = 1760; // the same as FEED_MAX in lib/layout.ts
/** The desktop filter column, left of the grid. */
export const FILTER_WIDTH = 240;

/**
 * What the list page draws (pure, so the gate is tested without a renderer).
 * Off desktop: no frame, no filter column, no toolbar row; the toolbar (if any)
 * goes inline above the children, as the screens draw it today.
 */
export function listPageParts({
  desktop,
  hasFilters,
  hasToolbar,
}: {
  desktop: boolean;
  hasFilters: boolean;
  hasToolbar: boolean;
}): { frame: boolean; filterColumn: boolean; toolbarRow: boolean; inlineToolbar: boolean } {
  if (!desktop) return { frame: false, filterColumn: false, toolbarRow: false, inlineToolbar: hasToolbar };
  return { frame: true, filterColumn: hasFilters, toolbarRow: hasToolbar, inlineToolbar: false };
}

export type ListToolbar = {
  /** Tabs, usually a `SegmentedTabs`. */
  left?: React.ReactNode;
  /** Sort, filter button, result count. */
  right?: React.ReactNode;
};

/**
 * The desktop "CardGrid page" (docs/design/desktop-web/PLAN.md, 4.2 c): Find work,
 * My Tasks / My Work, Saved, Orders, Notifications and the like. On a desktop
 * (`useLayout().desktop`) the content is centred up to 1760 wide, an optional
 * 240-wide `filters` column sits on a card on the left and stays in view while the
 * page scrolls, and the `toolbar` row (tabs left, sort / count right) sits above the
 * grid (`children`).
 *
 * Everywhere else it renders what the screen rendered before: the toolbar's pieces
 * inline (left, then right) and then the children. No filter column (the phone keeps
 * its filter sheet), no frame, no scroll view of its own.
 */
export function ListPage({
  children,
  toolbar,
  filters,
  scroll = true,
  scrollProps,
}: {
  children: React.ReactNode;
  toolbar?: ListToolbar;
  /** Desktop only: the filter column. */
  filters?: React.ReactNode;
  /** Desktop: the page scrolls as one (true), or the screen's own list scrolls inside the grid column (false). */
  scroll?: boolean;
  /** Desktop, with `scroll`: props for the page's ScrollView (test id, scroll handler, refresh control). */
  scrollProps?: ScrollViewProps;
}) {
  const { desktop } = useLayout();
  const t = useTheme();
  const hasToolbar = !!toolbar && (toolbar.left != null || toolbar.right != null);
  const parts = listPageParts({ desktop, hasFilters: filters != null, hasToolbar });
  if (!parts.frame) {
    return (
      <>
        {parts.inlineToolbar ? toolbar?.left : null}
        {parts.inlineToolbar ? toolbar?.right : null}
        {children}
      </>
    );
  }
  const body = (
    <View
      nativeID="listPage"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 24,
        width: '100%',
        maxWidth: LIST_MAX,
        alignSelf: 'center',
        flex: scroll ? undefined : 1,
      }}
    >
      {parts.filterColumn ? (
        <View
          nativeID="listPage-filters"
          style={[
            {
              width: FILTER_WIDTH,
              flexShrink: 0,
              backgroundColor: t.colors.surface,
              borderWidth: 1,
              borderColor: t.colors.line,
              borderRadius: t.radius.lg,
              padding: 16,
            },
            stickyTop,
          ]}
        >
          {filters}
        </View>
      ) : null}
      <View nativeID="listPage-main" style={{ flex: 1, minWidth: 0, alignSelf: scroll ? undefined : 'stretch' }}>
        {parts.toolbarRow ? (
          <View
            nativeID="listPage-toolbar"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}
          >
            <View style={{ flexGrow: 1, flexShrink: 0 }}>{toolbar?.left}</View>
            {toolbar?.right != null ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1, minWidth: 0 }}>{toolbar.right}</View>
            ) : null}
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
  if (!scroll) return <View style={{ flex: 1, paddingTop: 8 }}>{body}</View>;
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 28 }}
      keyboardShouldPersistTaps="handled"
      {...scrollProps}
    >
      {body}
    </ScrollView>
  );
}

export type SegmentedTab<K extends string = string> = { key: K; label: string; count?: number };

/** How the tabs draw: one pill-segmented control on a desktop, the phone's row of Pills elsewhere. */
export function segmentedTabsMode(desktop: boolean): 'segmented' | 'pills' {
  return desktop ? 'segmented' : 'pills';
}

/** What a screen reader says for a tab: "Open, 3". */
export function segmentedTabLabel(tab: { label: string; count?: number }): string {
  return typeof tab.count === 'number' ? `${tab.label}, ${tab.count}` : tab.label;
}

/**
 * Tabs for a list page's toolbar. Desktop: a quiet track with the chosen tab raised
 * on it, counts as small badges. Off desktop: a horizontally scrolling row of the
 * kit `Pill`, the way list screens draw their tabs on a phone.
 */
export function SegmentedTabs<K extends string>({
  tabs,
  value,
  onChange,
  inset = 20,
}: {
  tabs: SegmentedTab<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Off desktop: the row's side padding. */
  inset?: number;
}) {
  const { desktop, scale = 1 } = useLayout();
  const t = useTheme();
  if (segmentedTabsMode(desktop) === 'pills') {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: inset, gap: 8 }}>
        {tabs.map((tab) => (
          <Pill key={tab.key} label={tab.label} count={tab.count} active={tab.key === value} onPress={() => onChange(tab.key)} />
        ))}
      </ScrollView>
    );
  }
  return (
    <View
      nativeID="segmentedTabs"
      accessibilityRole="tablist"
      // Underline tabs (design section 3): text, a 2 px line under the chosen one, the count in a small grey pill.
      style={{ flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'stretch', gap: 28 }}
    >
      {tabs.map((tab) => {
        const on = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={segmentedTabLabel(tab)}
            accessibilityState={{ selected: on }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 52 / scale,
              borderBottomWidth: 2,
              borderBottomColor: on ? t.colors.accentDeep : 'transparent',
            }}
          >
            <Text style={tx(on ? '700' : '600', 14, on ? t.colors.ink : t.colors.muted)}>{tab.label}</Text>
            {typeof tab.count === 'number' ? (
              <View
                style={{
                  minWidth: 20,
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: 999,
                  alignItems: 'center',
                  backgroundColor: t.colors.surface2,
                }}
              >
                <Text style={tx('700', 11, t.colors.muted, { fontVariant: ['tabular-nums'] })}>
                  {tab.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// `position: 'sticky'` is web only (react-native-web passes it to the page); React Native's style type does not list it.
const stickyTop = { position: 'sticky', top: 24 } as unknown as ViewStyle;
