import type React from 'react';
import { useContext, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { DesktopPageScopeContext } from '../navigation/desktopPageContext';
import { Icon } from './Icon';
import { tx } from './primitives';
import type { DesktopCrumb, DesktopHeaderProps } from './pageHeader';

export type { DesktopHeaderProps, DesktopCrumb } from './pageHeader';

const SUB_LINE = 15;

/** The screens that are items of the desktop side menu: no "Back" link above their title. */
const SIDE_MENU_PAGES: ScreenName[] = ['home', 'explore', 'myTasks', 'wallet', 'inbox', 'notifications', 'profile', 'account', 'help'];

/**
 * Desktop web (docs/design/desktop-web/PLAN.md, 4.1): draws a screen's back link, title, subtitle and buttons into
 * the page header (navigation/DesktopPage.tsx) through React portals, so the buttons keep the screen's own state
 * and handlers. Returns:
 *   undefined  no page header above this screen (phone or tablet web, a full map): the caller draws its old row;
 *   null       the screen is hidden behind another one: draw nothing anywhere;
 *   portals    otherwise, to be rendered in place of the old row.
 * A screen that hands over a title, or only a back link (`BackButton`, whose screen keeps its own title in the page),
 * hides the header's default title while it is shown.
 */
export function useDesktopHeaderPortal({
  title,
  subtitle,
  onBack,
  right,
  left,
  center,
  crumbs,
}: DesktopHeaderProps): React.ReactNode | undefined {
  const t = useTheme();
  const { screen } = useNav();
  const scope = useContext(DesktopPageScopeContext);
  const active = scope?.active ?? false;
  const claimTitle = scope?.hosts.claimTitle;
  useLayoutEffect(() => {
    if (!active || !claimTitle) return;
    return claimTitle();
  }, [active, claimTitle]);

  if (!scope) return undefined;
  if (!active) return null;
  const { title: titleNode, actions: actionsNode, center: centerNode } = scope.hosts;
  // A screen's own left block (Home's area picker) or a breadcrumb replaces the back link and title.
  const custom = left ?? (crumbs && crumbs.length ? <Crumbs crumbs={crumbs} /> : null);
  return (
    <>
      {titleNode && custom ? createPortal(custom, titleNode) : null}
      {titleNode && !custom
        ? createPortal(
            <View style={subtitle && title ? { marginBottom: SUB_LINE - 2, top: SUB_LINE / 2 - 0.5 } : undefined}>
              {/* Pages in the side menu have no "Back" link: the menu is the way out (design D5/D7). */}
              {onBack && !(SIDE_MENU_PAGES as string[]).includes(scope.screen ?? screen) ? <BackLink onBack={onBack} /> : null}
              {title ? (
                <RNText accessibilityRole="header" style={tx('800', 26, t.colors.ink, { letterSpacing: -0.6 })} numberOfLines={1}>
                  {title}
                </RNText>
              ) : null}
              {/* The block is centred in the row, so it is nudged back up by half the sentence's height (a visual offset
                  only) and given the sentence's height as room below: the title stays exactly where it is on every page,
                  and the divider drops by the sentence's height. */}
              {subtitle ? (
                <RNText
                  style={tx('400', 13, t.colors.muted, title ? { lineHeight: SUB_LINE, marginTop: 2 } : { marginTop: 2 })}
                  numberOfLines={1}>
                  {subtitle}
                </RNText>
              ) : null}
            </View>,
            titleNode,
          )
        : null}
      {centerNode && center ? createPortal(center, centerNode) : null}
      {actionsNode && right ? createPortal(right, actionsNode) : null}
    </>
  );
}

/** "< Find work / Design & Creative": steps with `onPress` are links; the last step is this page. */
function Crumbs({ crumbs }: { crumbs: DesktopCrumb[] }) {
  const t = useTheme();
  const firstLink = crumbs.findIndex((c) => c.onPress);
  return (
    <View accessibilityLabel="Breadcrumb" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {crumbs.map((c, i) => (
        <View key={`${i}-${c.label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {i > 0 ? <RNText style={tx('400', 14, t.colors.muted)}>/</RNText> : null}
          {c.onPress ? (
            <Pressable onPress={c.onPress} accessibilityRole="link" hitSlop={6}>
              {({ hovered }: { pressed: boolean; hovered?: boolean }) => {
                const color = hovered ? t.colors.ink : t.colors.text;
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {i === firstLink ? <Icon name="back" size={14} color={color} strokeWidth={2} /> : null}
                    <RNText style={tx('600', 14, color)} numberOfLines={1}>
                      {c.label}
                    </RNText>
                  </View>
                );
              }}
            </Pressable>
          ) : (
            <RNText style={tx('500', 14, t.colors.muted)} numberOfLines={1}>
              {c.label}
            </RNText>
          )}
        </View>
      ))}
    </View>
  );
}

/** The small "Back" link above the title, muted until hovered. */
function BackLink({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onBack}
      accessibilityRole="link"
      accessibilityLabel="Back"
      hitSlop={6}
      style={{ alignSelf: 'flex-start', marginBottom: 4 }}
    >
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => {
        const color = hovered ? t.colors.ink : t.colors.muted;
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="back" size={14} color={color} strokeWidth={2} />
            <RNText style={tx('600', 13, color)}>Back</RNText>
          </View>
        );
      }}
    </Pressable>
  );
}
