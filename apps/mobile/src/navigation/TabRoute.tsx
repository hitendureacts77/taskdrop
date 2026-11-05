import { useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { SafeAreaView } from 'react-native-screens/experimental';
import { useTheme } from '../providers/ThemeProvider';
import { ScreenScope } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { hasPendingAccountAction } from '../lib/guest';
import { CreateFab } from '../components/CreateFab';
import { REGISTRY } from './registry';
import { useTabParams } from './navParams';
import type { NativeTab } from './nativeTabs';

/**
 * One of the five native tabs. The system keeps every tab mounted, so a tab
 * only builds the first time it is shown (five feeds loading at start-up
 * would be slow), then stays. Everything is dropped when the person changes
 * (except a guest finishing something with their new account, below).
 */
export function TabRoute({ name }: { name: NativeTab }) {
  const { userId, guest } = useAuth();
  // A guest (design D15) sees the tabs too, as on the web.
  const who = userId ?? (guest ? 'guest' : null);
  // Not dropped when a guest has just made their account to finish something (an offer
  // half-written in a sheet on Home): nothing on those tabs was anyone else's, and
  // rebuilding them would lose that offer. Same rule as navigation/ScreenHost.tsx on the web.
  const keptFor = useRef(who);
  if (keptFor.current !== who && !(keptFor.current === 'guest' && who !== null && hasPendingAccountAction())) {
    keptFor.current = who;
  }
  if (!who) return null;
  return <Tab key={keptFor.current ?? who} name={name} />;
}

function Tab({ name }: { name: NativeTab }) {
  const t = useTheme();
  const params = useTabParams(name);
  const focused = useIsFocused();
  const [shown, setShown] = useState(false);
  if (focused && !shown) setShown(true);

  const Comp = REGISTRY[name];
  if (!shown || !Comp) return null;
  return (
    // The native tab bar floats over the bottom of the screen; this keeps the
    // content clear of it. The top is each screen's own (ui.tsx Screen).
    <SafeAreaView edges={{ bottom: true }} style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScreenScope params={params} name={name}>
        <Comp />
      </ScreenScope>
      {name === 'home' && focused ? <CreateFab bottom={16} /> : null}
    </SafeAreaView>
  );
}
