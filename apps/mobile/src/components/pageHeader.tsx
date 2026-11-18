import type React from 'react';

export type DesktopHeaderProps = {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  /**
   * Desktop only (D31 web boards): drawn in place of the back link and title, e.g. Home's area picker.
   * Takes over the header's default title, like `title` does.
   */
  left?: React.ReactNode;
  /** Desktop only: the wide middle slot of the header, e.g. a search bar. */
  center?: React.ReactNode;
  /** Desktop only: a breadcrumb in place of the back link and title, e.g. "< Find work / Design & Creative". */
  crumbs?: DesktopCrumb[];
};

/** One step of a desktop breadcrumb. The first step that has `onPress` gets the back chevron. */
export type DesktopCrumb = { label: string; onPress?: () => void };

/**
 * The phone apps have no desktop page header: always `undefined`, so `TopBar` and `BackButton` draw what they
 * always drew. The web build uses pageHeader.web.tsx.
 */
export function useDesktopHeaderPortal(_props: DesktopHeaderProps): React.ReactNode | undefined {
  return undefined;
}
