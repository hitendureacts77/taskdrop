import type React from 'react';
import { Stack } from 'expo-router';

/** Fills in the system header of the screen it is rendered in (see nativeHeader.ts for which screens show one). */
export function NativeHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return <Stack.Screen options={{ title, headerRight: right ? () => right : undefined }} />;
}
