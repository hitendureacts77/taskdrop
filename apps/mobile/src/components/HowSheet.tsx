import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { BottomSheet } from './kit';
import { Icon, type IconName } from './Icon';
import { HowItWorks } from './HowItWorks';
import { ExplainerSheet } from './ExplainerSheet';
import type { ExplainerKey } from '../lib/explainers';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';

/**
 * What the "How TaskDrop works" pill on Home opens: a choice between the full
 * walkthrough (the same story a new install opens on) and a quick look, the
 * four small pictures for that side of the app.
 */
export function HowSheet({ visible, onClose, side }: { visible: boolean; onClose: () => void; side: 'hire' | 'earn' }) {
  const t = useTheme();
  const { go } = useNav();
  const [quick, setQuick] = useState(false);
  // Hunt or Plan a big day, opened in place: this sheet steps aside while it is up.
  const [explainer, setExplainer] = useState<ExplainerKey | null>(null);

  // Each time the sheet opens it starts on the choice, not on the last picture.
  useEffect(() => {
    if (visible) {
      setQuick(false);
      setExplainer(null);
    }
  }, [visible]);

  const option = (icon: IconName, title: string, sub: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 18,
        backgroundColor: t.colors.surface2,
        borderWidth: 1,
        borderColor: t.colors.line,
        marginBottom: 10,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={t.colors.accentDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <RNText style={tx('800', 15, t.colors.ink)}>{title}</RNText>
        <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 2, lineHeight: 17 })}>{sub}</RNText>
      </View>
      <Icon name="chevronRight" size={16} color={t.colors.muted} />
    </Pressable>
  );

  return (
    <>
    <BottomSheet
      visible={visible && explainer === null}
      onClose={onClose}
      title="How TaskDrop works"
      subtitle={quick ? (side === 'hire' ? 'Hiring, step by step' : 'Earning, step by step') : 'Pick how you want to see it'}
    >
      {quick ? (
        <>
          <HowItWorks side={side} />
          <Pressable onPress={() => setQuick(false)} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'center', marginTop: 14, padding: 8 }}>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>‹ Other ways to see it</RNText>
          </Pressable>
        </>
      ) : (
        <View style={{ paddingTop: 4 }}>
          {option('sparkle', 'Show the walkthrough', 'The full story, one short part at a time', () => {
            onClose();
            go('intro', { replay: true });
          })}
          {option('help', 'Quick look', 'A few simple pictures, nothing more', () => setQuick(true))}
          {side === 'hire' ? (
            <>
              {option('search', 'Find it for me (Hunt)', 'Many people look at once. You pay only the finder', () => setExplainer('hunt'))}
              {option('calendarCheck', 'Plan a big day', 'One date in, a whole plan of helpers out', () => setExplainer('bigDay'))}
            </>
          ) : null}
        </View>
      )}
    </BottomSheet>
    <ExplainerSheet
      which={explainer ?? 'hunt'}
      visible={visible && explainer !== null}
      // Back to the choice, not out of both sheets.
      onClose={() => setExplainer(null)}
      primaryLabel={explainer === 'bigDay' ? 'Plan my day' : 'Start a Hunt'}
      onPrimary={() => {
        const next = explainer;
        setExplainer(null);
        onClose();
        if (next === 'bigDay') go('bigDay');
        else go('aiPost', { prompt: 'Find me ', hunt: true });
      }}
    />
    </>
  );
}
