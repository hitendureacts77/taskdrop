import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../providers/ThemeProvider';
import { ScreenScope } from '../../providers/NavProvider';
import type { ScreenName } from '../../providers/navTypes';
import { Placeholder } from '../../screens/Placeholder';
import { REGISTRY } from '../../navigation/registry';
import { getParams } from '../../navigation/navParams';
import { NATIVE_HEADER_SCREENS, NativeHeaderCtx } from '../../navigation/nativeHeader';

/**
 * Every screen that is not one of the five tabs: a task, chat, settings, the
 * sign-in screens. go('taskDetail', { row }) opens /screen/taskDetail, and the
 * row travels in navParams under the key `k`.
 */
export default function ScreenRoute() {
  const t = useTheme();
  const { name, k } = useLocalSearchParams<{ name: string; k?: string }>();
  const screen = name as ScreenName;
  const Comp = REGISTRY[screen];
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <NativeHeaderCtx.Provider value={NATIVE_HEADER_SCREENS.includes(screen)}>
        <ScreenScope params={getParams(k)}>{Comp ? <Comp /> : <Placeholder name={screen} />}</ScreenScope>
      </NativeHeaderCtx.Provider>
    </View>
  );
}
