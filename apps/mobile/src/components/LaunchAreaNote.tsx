import { useSyncExternalStore } from 'react';
import { Text as RNText, View } from 'react-native';
import { getAppConfig, subscribeAppConfig } from '../lib/appConfig';
import { areaNames, outsideAreaMessage } from '../lib/launchAreas';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';

/**
 * Launch areas (admin, migration 260): shown while someone looks around a place outside every
 * area. They can still browse; posting a job there is refused with the same message.
 * Renders nothing while launch areas are off or the place is inside one.
 */
export function LaunchAreaNote({ at }: { at: { lat: number; lng: number } | null }) {
  const t = useTheme();
  const cfg = useSyncExternalStore(subscribeAppConfig, getAppConfig, getAppConfig);
  const message = at ? outsideAreaMessage(cfg.launchAreas, at.lat, at.lng) : null;
  if (!message) return null;
  const names = areaNames(cfg.launchAreas);
  return (
    <View
      accessibilityRole="alert"
      style={{ marginHorizontal: 12, marginVertical: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: t.colors.goldSoft }}
    >
      <RNText style={tx('600', 13, t.colors.goldInk, { lineHeight: 19 })}>
        {message}
        {names ? ` Open now in ${names}.` : ''}
      </RNText>
    </View>
  );
}
