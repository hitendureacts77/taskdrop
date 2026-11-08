import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { EXPLAINERS, fillFee, type ExplainerExample, type ExplainerKey } from '../lib/explainers';
import { markExplainerSeen, needsExplainer } from '../lib/explainerStore';
import { useFees } from '../lib/useFees';
import { BottomSheet, PrimaryButton } from './kit';
import { HowItWorks } from './HowItWorks';
import { Icon } from './Icon';
import { tx } from './primitives';
import { cardSurface } from './ui';

/**
 * The "how it works" sheet for a City Hunt (as the person posting it and as a
 * finder) and for Plan a big day: three drawn steps, who it is for, and a few
 * examples. It opens by itself the first time per account and device
 * (useExplainerOnce) and any small "How it works" link can open it again.
 *
 * Examples are cards. When `onExample` is given each one is a button
 * ("Try this"); otherwise they are plain read-only cards.
 */
export function ExplainerSheet({
  which,
  visible,
  onClose,
  onExample,
  primaryLabel,
  onPrimary,
}: {
  which: ExplainerKey;
  visible: boolean;
  onClose: () => void;
  onExample?: (example: ExplainerExample) => void;
  primaryLabel?: string;
  onPrimary?: () => void;
}) {
  const t = useTheme();
  const { posterFee } = useFees();
  const e = EXPLAINERS[which];
  // Hunts are gold (the finder's reward); Big Day keeps the jade of hiring.
  const gold = which === 'hunt' || which === 'huntFinder';
  const tone = gold ? t.colors.goldInk : t.colors.accentDeep;
  const soft = gold ? t.colors.gold + '1F' : t.colors.accentSoft;
  const onTone = gold ? (t.isDark ? '#1A1206' : '#FFFFFF') : t.colors.onBtn;
  const steps = e.steps.map((s) => ({ ...s, body: fillFee(s.body, posterFee) }));

  const label = (text: string) => (
    <RNText style={tx('800', 11, t.colors.muted, { letterSpacing: 1, marginTop: 22, marginBottom: 10 })} accessibilityRole="header">
      {text}
    </RNText>
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={e.title}
      subtitle={e.subtitle}
      footer={<PrimaryButton label={primaryLabel ?? e.doneLabel} onPress={onPrimary ?? onClose} />}
    >
      <HowItWorks steps={steps} tone={tone} soft={soft} onTone={onTone} />

      {label(e.whoForTitle)}
      <View style={{ gap: 10 }}>
        {e.whoFor.map((line) => (
          <View key={line} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <View style={{ marginTop: 1 }}>
              <Icon name="check" size={16} color={tone} />
            </View>
            <RNText style={tx('500', 14, t.colors.ink, { flex: 1, lineHeight: 20 })}>{line}</RNText>
          </View>
        ))}
      </View>

      {label(e.examplesTitle)}
      <View style={{ gap: 10 }}>
        {e.examples.map((ex) => {
          const body = (
            <>
              <View style={{ flex: 1 }}>
                <RNText style={tx('800', 14.5, t.colors.ink)}>{ex.title}</RNText>
                <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 3, lineHeight: 18 })}>{ex.detail}</RNText>
              </View>
              {onExample ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <RNText style={tx('700', 12.5, tone)}>Try this</RNText>
                  <Icon name="chevronRight" size={14} color={tone} />
                </View>
              ) : null}
            </>
          );
          const frame = { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 } as const;
          return onExample ? (
            <Pressable
              key={ex.title}
              onPress={() => onExample(ex)}
              accessibilityRole="button"
              accessibilityLabel={`Try this example: ${ex.title}`}
              accessibilityHint={ex.detail}
              style={({ pressed }) => [cardSurface(t, 16), frame, { transform: [{ scale: pressed ? t.motion.pressScale : 1 }] }]}
            >
              {body}
            </Pressable>
          ) : (
            <View key={ex.title} accessible accessibilityLabel={`${ex.title}. ${ex.detail}`} style={[cardSurface(t, 16), frame]}>
              {body}
            </View>
          );
        })}
      </View>

      {e.footnote ? <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 16, lineHeight: 18 })}>{e.footnote}</RNText> : null}
    </BottomSheet>
  );
}

/**
 * Opens an explainer by itself the first time this person (or guest) meets the
 * feature on this device, and lets a link open it again. Closing it in any way
 * counts as seen. `enabled` holds the check back until the screen knows who
 * the owner is and that it really is the feature's entry (a resumed draft, for
 * one, is not a first visit). If storage cannot be read the sheet shows.
 */
export function useExplainerOnce(which: ExplainerKey, owner: string, enabled: boolean) {
  const [open, setOpen] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    if (!enabled || checked.current) return;
    checked.current = true;
    void needsExplainer(which, owner).then((need) => {
      if (need) setOpen(true);
    });
  }, [enabled, which, owner]);

  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    setOpen(false);
    void markExplainerSeen(which, owner);
  }, [which, owner]);

  return { open, show, close };
}
