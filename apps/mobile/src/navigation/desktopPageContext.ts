import { createContext } from 'react';
import type { ScreenName } from '../providers/NavProvider';

/**
 * Desktop web only (docs/design/desktop-web/PLAN.md, 4.1): where a screen's `TopBar` / `BackButton` put their
 * title, back link and buttons. The page header (navigation/DesktopPage.tsx) owns the two DOM nodes; each screen
 * ScreenHost shows is wrapped in a scope that says whether it is the one in front, so a kept-alive tab hidden
 * behind another screen never draws into the header.
 *
 * Kept in its own file, with no imports from the kit, so components/kit.tsx can read it without a cycle.
 */
export type DesktopPageHosts = {
  /** The node the title block is drawn into (a `View` is a DOM element on web). */
  title: HTMLElement | null;
  /** The node the screen's own buttons are drawn into, left of the bell, messages and avatar. */
  actions: HTMLElement | null;
  /** The wide middle of the header, between the title and the buttons (a search bar on Home and Find work). */
  center: HTMLElement | null;
  /** Hide the header's default title while a screen draws its own; returns the release. */
  claimTitle: () => () => void;
};

export type DesktopPageScopeValue = {
  hosts: DesktopPageHosts;
  /** This screen is the one in front. */
  active: boolean;
  /** The screen this scope draws (not always the navigator's current one: "How TaskDrop works" opens over the page behind it). */
  screen?: ScreenName;
};

export const DesktopPageHostsContext = createContext<DesktopPageHosts | null>(null);
export const DesktopPageScopeContext = createContext<DesktopPageScopeValue | null>(null);
