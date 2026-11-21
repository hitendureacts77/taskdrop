import React from 'react';
import { View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';

/** The widest a desktop row card gets (docs/design/desktop-web/PLAN.md, 4.2 c: plain row lists). */
export const ROW_CARD_MAX = 880;

/**
 * Desktop only (the screen decides with `useLayout().desktop`): a plain list of rows on one centred card, up to
 * 880 wide, with a hairline between the rows, instead of one separate card per row.
 *
 * - Default: the card draws the hairlines between its children.
 * - `ownDividers`: the rows already draw a line under themselves (the idea rows do); the card only hides the last one.
 */
export function RowCard({ children, ownDividers = false }: { children: React.ReactNode; ownDividers?: boolean }) {
  const t = useTheme();
  const rows = React.Children.toArray(children);
  return (
    <View
      style={{
        width: '100%',
        maxWidth: ROW_CARD_MAX,
        alignSelf: 'center',
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        borderRadius: t.radius.lg,
        overflow: 'hidden',
      }}
    >
      <View style={{ marginBottom: ownDividers ? -1 : 0, paddingHorizontal: ownDividers ? 16 : 0 }}>
        {rows.map((row, i) => (
          <View
            key={React.isValidElement(row) && row.key != null ? row.key : i}
            style={!ownDividers && i > 0 ? { borderTopWidth: 1, borderTopColor: t.colors.line } : undefined}
          >
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}
