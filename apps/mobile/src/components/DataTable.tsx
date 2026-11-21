import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';

export type DataColumn<T> = {
  key: string;
  /** The column heading, exactly as shown. */
  title: string;
  /** Fixed width in px; without it the column shares what is left (`flex`, default 1). */
  width?: number;
  flex?: number;
  align?: 'left' | 'right';
  render: (row: T, index: number) => React.ReactNode;
};

/**
 * A small desktop table (docs/design/desktop-web/PLAN.md, package 11): a heading row,
 * then one row per item with a hairline between rows, on one card. It is for a
 * desktop page only; a screen renders its own phone list when `useLayout().desktop`
 * is false. Colours come from the theme. It knows nothing about the data: each
 * column's `render` draws the cell, so the screen's own formatting stays in the screen.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  wrapRow,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Wraps a finished row, e.g. in an entrance animation. */
  wrapRow?: (row: T, index: number, node: React.ReactElement) => React.ReactElement;
}) {
  const t = useTheme();
  const cellStyle = (c: DataColumn<T>) =>
    c.width != null
      ? { width: c.width, flexShrink: 0 }
      : { flex: c.flex ?? 1, minWidth: 0 };
  return (
    <View
      nativeID="dataTable"
      accessibilityRole="table"
      style={{
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderRadius: t.radius.lg,
        overflow: 'hidden',
      }}
    >
      <View
        accessibilityRole="row"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 24,
          paddingHorizontal: 20,
          paddingVertical: 11,
          backgroundColor: t.colors.surface2,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.line,
        }}
      >
        {columns.map((c) => (
          <View key={c.key} style={[cellStyle(c), { alignItems: c.align === 'right' ? 'flex-end' : 'flex-start' }]}>
            <Text accessibilityRole="columnheader" style={tx('700', 12, t.colors.muted)}>
              {c.title}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((row, i) => {
        const node = (
          <View
            key={rowKey(row)}
            accessibilityRole="row"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 24,
              paddingHorizontal: 20,
              paddingVertical: 14,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: t.colors.line,
            }}
          >
            {columns.map((c) => (
              <View key={c.key} style={[cellStyle(c), { alignItems: c.align === 'right' ? 'flex-end' : 'flex-start' }]}>
                {c.render(row, i)}
              </View>
            ))}
          </View>
        );
        return wrapRow ? React.cloneElement(wrapRow(row, i, node), { key: rowKey(row) }) : node;
      })}
    </View>
  );
}
