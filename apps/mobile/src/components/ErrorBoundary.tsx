import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { reportError } from '../lib/errors';

type Props = {
  children: React.ReactNode;
  /** When this changes after a crash, the boundary tries its children again (e.g. the user navigated away). */
  resetKey?: unknown;
  /** Offered as a second way out of the crash screen. */
  onHome?: () => void;
  /** Render nothing on a crash instead of the crash screen -- for background pieces that have no UI of their own. */
  silent?: boolean;
};

type State = { failed: boolean };

/**
 * Catches anything that throws while a part of the app renders, so one broken
 * screen shows a calm "try again" page instead of a blank window.
 *
 * It deliberately uses plain views and fixed colours. If the theme or a
 * provider is what crashed, a fallback that read from them would crash too.
 * Nothing about the error is shown: no message, no stack. Those go to
 * `reportError` only.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportError(error, 'render');
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private retry = () => this.setState({ failed: false });

  private reload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
    else this.retry();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.silent) return null;

    const { onHome } = this.props;
    return (
      <View style={s.wrap} accessibilityRole="alert">
        <Text style={s.title}>Something went wrong</Text>
        <Text style={s.body}>
          We hit a problem showing this page. Nothing you entered or paid for was lost.
        </Text>
        <Pressable style={s.primary} onPress={this.retry} accessibilityRole="button">
          <Text style={s.primaryText}>Try again</Text>
        </Pressable>
        {onHome ? (
          <Pressable
            style={s.secondary}
            onPress={() => {
              this.setState({ failed: false });
              onHome();
            }}
            accessibilityRole="button"
          >
            <Text style={s.secondaryText}>Go to home</Text>
          </Pressable>
        ) : null}
        {Platform.OS === 'web' ? (
          <Pressable onPress={this.reload} accessibilityRole="button" style={s.link}>
            <Text style={s.linkText}>Reload the page</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#0F1012',
  },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: {
    color: '#B8BBC2',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 26,
    maxWidth: 340,
  },
  primary: {
    backgroundColor: '#2FBF96',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 34,
    minWidth: 200,
    alignItems: 'center',
  },
  primaryText: { color: '#06231B', fontSize: 16, fontWeight: '700' },
  secondary: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3A3D44',
    paddingVertical: 13,
    paddingHorizontal: 34,
    minWidth: 200,
    alignItems: 'center',
  },
  secondaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  link: { marginTop: 18, padding: 8 },
  linkText: { color: '#8A8F98', fontSize: 14, textDecorationLine: 'underline' },
});
