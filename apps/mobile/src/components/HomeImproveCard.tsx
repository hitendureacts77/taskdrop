import { useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import type { Idea } from '../lib/ideas';
import { Icon } from './Icon';
import { IdeaSheet } from './IdeaSheet';
import { HitArea, tx } from './primitives';
import { cardSurface } from './ui';

export const HOME_IMPROVE_COPY = {
  title: 'Help improve TaskDrop',
  body: 'Suggest a feature, or share what you know from your work. We read every idea.',
  suggest: 'Suggest a feature',
  all: 'See all ideas',
} as const;

/**
 * "Help improve TaskDrop" on both Homes (owner, 26 Nov): one small card, high enough on Home to be seen. "Suggest a
 * feature" opens the board's new-idea sheet; the whole board (top ideas, votes) lives on the Ideas & feedback page,
 * on Profile under Ideas & feedback (HomeFeedbackCard, task 1.19 F). A guest who posts gets the account pop-up from the server call, as on the board.
 */
export function HomeImproveCard() {
  const t = useTheme();
  const { go } = useNav();
  const [suggest, setSuggest] = useState(false);
  const open = (idea: Idea) => go('ideaDetail', { ideaId: idea.id });

  return (
    <View style={[cardSurface(t, 18), { marginTop: 20, padding: 14, gap: 12 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={18} color={t.colors.accentDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <RNText accessibilityRole="header" style={tx('800', 15, t.colors.ink)}>
            {HOME_IMPROVE_COPY.title}
          </RNText>
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 2, lineHeight: 18 })}>{HOME_IMPROVE_COPY.body}</RNText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <Pressable
          onPress={() => setSuggest(true)}
          accessibilityRole="button"
          accessibilityLabel={HOME_IMPROVE_COPY.suggest}
          style={({ pressed }) => ({
            paddingVertical: 9,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: t.colors.btn,
            transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
          })}
        >
          <RNText style={tx('800', 13.5, t.colors.onBtn)}>{HOME_IMPROVE_COPY.suggest}</RNText>
        </Pressable>
        <Pressable onPress={() => go('ideas')} accessibilityRole="button" accessibilityLabel={HOME_IMPROVE_COPY.all}>
          <HitArea x={8} y={10} />
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{HOME_IMPROVE_COPY.all} ›</RNText>
        </Pressable>
      </View>
      <IdeaSheet visible={suggest} onClose={() => setSuggest(false)} onPosted={open} onOpenIdea={open} />
    </View>
  );
}
