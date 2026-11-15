import { View } from 'react-native';
import { HeaderTools } from '../components/AppHeader';

/** The screens' own content sits this far in from the column edge. */
const CONTENT_INSET = 20;

/**
 * Desktop web only: the one bar above every screen's column (PLAN.md, Q5).
 * Notifications, messages and the account menu sit at the column's right
 * edge, in line with the content, on every screen -- not only on the four
 * tabs that draw AppHeader, and not at a different x on each. ScreenHost
 * renders it inside the column, so it shares the column's width and gutter.
 */
export function DesktopTopBar() {
  return (
    <View
      style={{
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingHorizontal: CONTENT_INSET,
      }}
    >
      <HeaderTools />
    </View>
  );
}
