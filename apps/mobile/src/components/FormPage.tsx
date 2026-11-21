import React, { createContext } from 'react';
import { ScrollView, Text, View, type ScrollViewProps, type ViewStyle } from 'react-native';
import { useLayout } from '../lib/layout';
import { useTheme } from '../providers/ThemeProvider';
import { KeyboardScrollView } from './KeyboardScrollView';
import { tx } from './primitives';

/**
 * The desktop form page (docs/design/desktop-web/PLAN.md, 4.2 a): onboarding,
 * worker setup, posting, profile edit, withdraw and the like. On a desktop
 * (`useLayout().desktop`) the form sits on a 720-wide card with an optional
 * 320-wide `aside` beside it that stays in view while the page scrolls; the
 * `actions` (an `ActionBar`) end the card and stick to the bottom of the window.
 *
 * Everywhere else it renders exactly what the screen rendered before: its
 * `KeyboardScrollView` with the same props, the children, and the actions
 * either inline at the end of the scroll (worker setup) or pinned under it
 * (onboarding). So a screen swaps its scroll view for FormPage and its phone
 * tree does not change.
 */
export function FormPage({
  children,
  actions,
  aside,
  phoneActions = 'inline',
  scrollProps,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** Desktop only: the column beside the card (a live preview, the steps, tips). */
  aside?: React.ReactNode;
  /** Off desktop: actions at the end of the scroll, or under it. */
  phoneActions?: 'inline' | 'pinned';
  /** Off desktop: the props of the screen's own KeyboardScrollView. */
  scrollProps?: React.ComponentProps<typeof KeyboardScrollView>;
}) {
  const { desktop } = useLayout();
  const t = useTheme();
  if (!desktop) {
    return (
      <>
        <KeyboardScrollView {...scrollProps}>
          {children}
          {phoneActions === 'inline' ? actions : null}
        </KeyboardScrollView>
        {phoneActions === 'pinned' ? actions : null}
      </>
    );
  }
  return (
    <ScrollView
      ref={desktopScrollRef(scrollProps)}
      nativeID="formPage"
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 28 }}
      keyboardShouldPersistTaps="handled"
      {...desktopScrollProps(scrollProps)}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 24 }}>
        <View
          nativeID="formPage-card"
          style={{
            flex: 1,
            maxWidth: 720,
            minWidth: 0,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: t.radius.lg,
            padding: 28,
          }}
        >
          {children}
          {actions}
        </View>
        {aside ? (
          <View nativeID="formPage-aside" style={[{ width: 320, flexShrink: 0 }, stickyTop]}>
            {aside}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** The few scroll props that still mean something on the desktop page (a test id, the scroll handler). */
function desktopScrollProps(props: ScrollViewProps | undefined): ScrollViewProps {
  if (!props) return {};
  const { testID, onScroll, scrollEventThrottle } = props;
  return { testID, onScroll, scrollEventThrottle };
}

/** The screen's own scroll ref (a step flow scrolling each step back to its top), given to the desktop page. */
function desktopScrollRef(props: React.ComponentProps<typeof KeyboardScrollView> | undefined) {
  return props?.ref as React.Ref<React.ComponentRef<typeof ScrollView>> | undefined;
}

/**
 * A titled block of the form. Desktop: a hairline above it (none when `first`),
 * the `title` and `hint` above the children, or, with `side`, in a 200-wide
 * column to their left. Off desktop it renders `children` untouched and draws
 * no title: a screen keeps its own phone label by passing it in `children`
 * when not on a desktop.
 */
export function FormSection({
  title,
  hint,
  children,
  first,
  side,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  first?: boolean;
  side?: boolean;
}) {
  const { desktop } = useLayout();
  const t = useTheme();
  if (!desktop) return <>{children}</>;
  const head =
    title || hint ? (
      <View style={side ? { width: 200, flexShrink: 0 } : { marginBottom: 12 }}>
        {title ? <Text style={tx('700', 15, t.colors.ink)}>{title}</Text> : null}
        {hint ? <Text style={tx('400', 13, t.colors.muted, { marginTop: 4, lineHeight: 19 })}>{hint}</Text> : null}
      </View>
    ) : null;
  return (
    <View
      style={{
        paddingTop: first ? 0 : 20,
        paddingBottom: 20,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.colors.line,
        flexDirection: side ? 'row' : 'column',
        gap: side ? 24 : 0,
      }}
    >
      {head}
      <View style={side ? { flex: 1, minWidth: 0 } : undefined}>{children}</View>
    </View>
  );
}

/** Fields side by side on a desktop, equal widths, 16 apart. Off desktop: the children untouched. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  const { desktop } = useLayout();
  if (!desktop) return <>{children}</>;
  return (
    <View style={{ flexDirection: 'row', gap: 16 }}>
      {React.Children.toArray(children).map((child, i) => (
        <View key={i} style={{ flex: 1, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** True inside a desktop ActionBar: a PrimaryButton there is its natural width, not full width. */
export const ActionBarContext = createContext(false);

/**
 * The form's buttons. Desktop: a row under a hairline, the `hint` on the left,
 * the buttons on the right, sticking to the bottom of the window while the
 * card scrolls. Off desktop: the children, then the hint (worker setup's order).
 */
export function ActionBar({ hint, children }: { hint?: React.ReactNode; children: React.ReactNode }) {
  const { desktop } = useLayout();
  const t = useTheme();
  if (!desktop) {
    return (
      <>
        {children}
        {hint}
      </>
    );
  }
  return (
    <View
      nativeID="formPage-actions"
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 16,
          marginTop: 8,
          paddingVertical: 16,
          borderTopWidth: 1,
          borderTopColor: t.colors.line,
          backgroundColor: t.colors.surface,
        },
        stickyBottom,
      ]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof hint === 'string' ? <Text style={tx('400', 13, t.colors.muted, { lineHeight: 19 })}>{hint}</Text> : hint}
      </View>
      <ActionBarContext.Provider value={true}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>{children}</View>
      </ActionBarContext.Provider>
    </View>
  );
}

// `position: 'sticky'` is web only (react-native-web passes it to the page); React Native's style type does not list it.
const stickyTop = { position: 'sticky', top: 24 } as unknown as ViewStyle;
const stickyBottom = { position: 'sticky', bottom: 0, zIndex: 1 } as unknown as ViewStyle;
