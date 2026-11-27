import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useFocusTick, useNav, type ScreenName } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { listIdeas, voteIdea } from '../data/extras';
import { withVote, withVoteResult, type Idea } from '../lib/ideas';
import { reportError } from '../lib/errors';
import { isNeedsAccount } from '../lib/guest';
import { VoteBox } from './IdeaRow';
import { IdeaSheet } from './IdeaSheet';
import { SectionTitle } from './kit';
import { HitArea, tx } from './primitives';
import { cardSurface } from './ui';

/**
 * "Suggest a feature" (owner, 23 Nov): the top three ideas on the public board with the same vote box the board
 * uses, a "See all" link to the board, and a button that opens the board's new-idea sheet. A guest's vote is turned
 * into the account pop-up by the server call itself (guest.ts), exactly as on the board. Task 1.19 F (decision 4):
 * it left both Homes and sits on Profile, under the Ideas & feedback row; `on` is the screen that shows it.
 */
export function HomeFeedbackCard({ on = 'profile' }: { on?: ScreenName }) {
  const t = useTheme();
  const { go, screen } = useNav();
  const { flash } = useActions();
  const tick = useFocusTick();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [suggest, setSuggest] = useState(false);
  const ask = useRef(0);

  const load = useCallback(async () => {
    const mine = ++ask.current;
    try {
      const rows = await listIdeas({ sort: 'top', limit: 3 });
      if (mine === ask.current) setIdeas(rows.slice(0, 3));
    } catch (e) {
      reportError(e, 'ideas.home');
      // A failed read shows the same short card as an empty board: the sub line and the button.
      if (mine === ask.current) setIdeas((prev) => prev ?? []);
    }
  }, []);

  // Reads when its screen is showing and again each time it regains focus, the same pattern as Home's reads.
  useEffect(() => {
    if (screen === on) void load();
  }, [screen, on, tick, load]);

  const swap = (id: string, fn: (i: Idea) => Idea) => setIdeas((cur) => (cur ?? []).map((i) => (i.id === id ? fn(i) : i)));

  const vote = async (idea: Idea) => {
    const on = !idea.iVoted;
    swap(idea.id, (i) => withVote(i, on));
    try {
      const r = await voteIdea(idea.id, on);
      swap(idea.id, (i) => withVoteResult(i, r));
    } catch (e) {
      swap(idea.id, (i) => withVote(i, !on));
      if (isNeedsAccount(e)) return;
      flash(e instanceof Error ? e.message : 'Could not save your vote');
    }
  };

  const open = (idea: Idea) => go('ideaDetail', { ideaId: idea.id });
  const rows = ideas ?? [];

  return (
    <View style={{ marginTop: 28, marginBottom: 8 }}>
      <SectionTitle title="Suggest a feature" icon="trending" action="See all" onAction={() => go('ideas')} />
      <View style={[cardSurface(t, 20), { marginTop: 12, paddingHorizontal: 14, paddingVertical: 14 }]}>
        <RNText style={tx('400', 13.5, t.colors.muted, { lineHeight: 20 })}>Vote for what we build next, or suggest your own.</RNText>
        {rows.map((idea) => (
          <View
            key={idea.id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: t.colors.line, marginTop: 10 }}
          >
            <Pressable onPress={() => open(idea)} accessibilityRole="button" style={{ flex: 1 }}>
              <RNText style={tx('700', 14, t.colors.ink, { lineHeight: 20 })} numberOfLines={2}>
                {idea.title}
              </RNText>
            </Pressable>
            <VoteBox idea={idea} onVote={(i) => void vote(i)} />
          </View>
        ))}
        <Pressable
          onPress={() => setSuggest(true)}
          accessibilityRole="button"
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            marginTop: rows.length ? 4 : 12,
            borderWidth: 1.5,
            borderColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 9,
            paddingHorizontal: 16,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <HitArea x={8} y={8} />
          <RNText style={tx('700', 13.5, t.colors.accentDeep)}>Suggest an idea</RNText>
        </Pressable>
      </View>
      <IdeaSheet
        visible={suggest}
        onClose={() => setSuggest(false)}
        onPosted={(idea) => {
          void load();
          open(idea);
        }}
        onOpenIdea={open}
      />
    </View>
  );
}
