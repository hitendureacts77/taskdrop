import { View } from 'react-native';
import { Screen, Text, Button } from '../components/ui';
import { useNav, type ScreenName } from '../providers/NavProvider';

/** What a link to a page that does not exist shows. Every screen name is registered (navigation/registry.test.ts), so this is only a safety net. */
export function Placeholder({ name: _name }: { name: ScreenName }) {
  const { back } = useNav();
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text variant="h1">This page isn’t available</Text>
        <Text color="muted">The link may be old. Go back and try again.</Text>
        <Button label="Back" variant="ghost" onPress={back} />
      </View>
    </Screen>
  );
}
