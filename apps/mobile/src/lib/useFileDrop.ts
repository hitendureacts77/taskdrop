import type { Ref } from 'react';
import type { View } from 'react-native';

/**
 * Drag-and-drop of a file onto a view. Web only: on phones there is nothing to
 * drop onto, so this is inert. See useFileDrop.web.ts.
 */
export function useFileDrop(_opts: { enabled?: boolean; onFile: (file: File) => void }): {
  ref: Ref<View> | undefined;
  over: boolean;
} {
  return { ref: undefined, over: false };
}
