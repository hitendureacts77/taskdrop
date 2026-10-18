import { useRef } from 'react';
import { useIsFocused } from 'expo-router';
import { SafeAreaView } from 'react-native-screens/experimental';
import { useTheme } from '../providers/ThemeProvider';
import { ScreenScope } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { CreateFab } from '../components/CreateFab';
import { REGISTRY } from './registry';
import { useTabParams } from './navParams';
import type { NativeTab } from './nativeTabs';

/**
 * One of the five native tabs. The system keeps every tab mounted, so a tab
 * only builds the first time it is shown (five feeds loading at start-up
 * would be slow), then stays. Everything is dropped when the person changes.
 */
export function TabRoute({ name }: { name: NativeTab }) {
  const { userId } = useAuth();
  if (!userId) return null;
  return <Tab key={userId} name={name} />;
}

function Tab({ name }: { name: NativeTab }) {
  const t = useTheme();
  const params = useTabParams(name);
  const focused = useIsFocused();
  const shown = useRef(false);
  if (focused) shown.current = true;

  const Comp = REGISTRY[name];
  if (!shown.current || !Comp) return null;
  return (
    // The native tab bar floats over the bottom of the screen; this keeps the
    // content clear of it. The top is each screen's own (ui.tsx Screen).
    <SafeAreaView edges={{ bottom: true }} style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScreenScope params={params}>
        <Comp />
      </ScreenScope>
      {name === 'home' && focused ? <CreateFab bottom={16} /> : null}
    </SafeAreaView>
  );
}
