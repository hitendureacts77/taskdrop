import type React from 'react';
import { Stack } from 'expo-router';

/**
 * Fills in the system header of the screen it is rendered in (see nativeHeader.ts for which screens show one).
 * `titleView` replaces the plain title with a view of the screen's own (the chat's person and presence).
 */
export function NativeHeader({
  title,
  right,
  titleView,
}: {
  title: string;
  right?: React.ReactNode;
  titleView?: React.ReactNode;
}) {
  return (
    <Stack.Screen
      options={{
        title,
        headerRight: right ? () => right : undefined,
        headerTitle: titleView ? () => titleView : undefined,
      }}
    />
  );
}
