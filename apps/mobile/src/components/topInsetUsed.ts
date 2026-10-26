import { createContext, useContext } from 'react';

/**
 * True while something above the app (the staging ribbon or an announcement
 * banner, see AppGate) has already used the status-bar gap. The native
 * `SafeAreaView` measures that gap itself and ignores the JS insets context
 * AppGate overrides, so screens that pad the top edge ask this instead.
 */
export const TopInsetUsedCtx = createContext(false);

/** Edges a full-screen container pads at the top: none when the gap is already used. */
export function useTopInsetEdges(): ['top'] | [] {
  return useContext(TopInsetUsedCtx) ? [] : ['top'];
}
