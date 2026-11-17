import type React from 'react';

export type DesktopHeaderProps = {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
};

/**
 * The phone apps have no desktop page header: always `undefined`, so `TopBar` and `BackButton` draw what they
 * always drew. The web build uses pageHeader.web.tsx.
 */
export function useDesktopHeaderPortal(_props: DesktopHeaderProps): React.ReactNode | undefined {
  return undefined;
}
