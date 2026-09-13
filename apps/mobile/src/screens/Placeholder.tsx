import { View } from 'react-native';
import { Screen, Text, Button } from '../components/ui';
import { useNav, type ScreenName } from '../providers/NavProvider';

/** Temporary stand-in for screens the build agents haven't delivered yet. */
export function Placeholder({ name }: { name: ScreenName }) {
  const { back } = useNav();
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text variant="h1">{name}</Text>
        <Text color="muted">This screen is being built by the agent team.</Text>
        <Button label="Back" variant="ghost" onPress={back} />
      </View>
    </Screen>
  );
}
