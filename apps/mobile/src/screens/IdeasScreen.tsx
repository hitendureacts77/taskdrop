import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, ScrollView } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { IdeaRow } from '../components/IdeaRow';
import { IdeaSheet } from '../components/IdeaSheet';
import { KeyboardScrollView } from '../components/KeyboardScrollView';
import { EmptyState, Field, LoadFailed, Pill, PrimaryButton, Shimmer, TopBar } from '../components/kit';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { listIdeas, voteIdea } from '../data/extras';
import { STATUS_FILTERS, withVote, withVoteResult, type Idea, type IdeaStatus } from '../lib/ideas';
import { reportError } from '../lib/errors';
import { isNeedsAccount } from '../lib/guest';

const PAGE = 30;

/**
 * Ideas & feedback: the public board (migration 136). People suggest what
 * TaskDrop should do next and vote on what they want; the team sets each idea's
 * status and replies, so everyone can see what is planned and what shipped. The
 * private "Send feedback" box in Help & support is still there for anything that
 * should not be public.
 */
export function IdeasScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { flash } = useActions();
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [status, setStatus] = useState<IdeaStatus | null>(null);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [suggest, setSuggest] = useState(false);
  // Only the newest question may fill the list: a slow answer to an old filter must not replace a newer one.
  const ask = useRef(0);

  // The search box waits for a pause in typing before it asks the server.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const load = useCallback(async () => {
    const mine = ++ask.current;
    try {
      const rows = await listIdeas({ sort, status, search, limit: PAGE });
      if (mine !== ask.current) return;
      setIdeas(rows);
      setMore(rows.length === PAGE);
      setFailed(false);
    } catch (e) {
      if (mine !== ask.current) return;
      reportError(e, 'ideas.load');
      setFailed(true);
      setIdeas((prev) => prev ?? []);
    }
  }, [sort, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const showMore = async () => {
    if (!ideas || loadingMore) return;
    const mine = ask.current;
    setLoadingMore(true);
    try {
      const rows = await listIdeas({ sort, status, search, limit: PAGE, offset: ideas.length });
      if (mine !== ask.current) return;
      // A vote can move an idea between pages, so a repeat is dropped rather than shown twice.
      setIdeas((cur) => {
        const seen = new Set((cur ?? []).map((i) => i.id));
        return [...(cur ?? []), ...rows.filter((r) => !seen.has(r.id))];
      });
      setMore(rows.length === PAGE);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not load more');
    } finally {
      setLoadingMore(false);
    }
  };

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
  const filtering = status !== null || search !== '';

  return (
    <Screen padded={false}>
      <TopBar title="Ideas & feedback" onBack={back} />
      <KeyboardScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.6 })}>Help shape taskdrop.</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 6, lineHeight: 21 })}>
          Suggest what we should build next, and vote for what you want. We read every idea, and tell you when one is planned or live.
        </RNText>
        <PrimaryButton label="Suggest an idea" onPress={() => setSuggest(true)} style={{ marginTop: 14 }} />

        <Field
          style={{ marginTop: 16 }}
          value={typed}
          onChangeText={setTyped}
          placeholder="Search ideas"
          maxLength={60}
          returnKeyType="search"
          left={<Icon name="search" size={18} color={t.colors.muted} />}
        />

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Pill label="Top" icon="trending" active={sort === 'top'} onPress={() => setSort('top')} />
          <Pill label="New" icon="clock" active={sort === 'new'} onPress={() => setSort('new')} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10, marginHorizontal: -20 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
          {STATUS_FILTERS.map((f) => (
            <Pill key={f.label} label={f.label} active={status === f.key} onPress={() => setStatus(f.key)} />
          ))}
        </ScrollView>

        <View style={{ marginTop: 8 }}>
          {ideas === null ? (
            <>
              <Shimmer height={78} style={{ marginTop: 12 }} />
              <Shimmer height={78} style={{ marginTop: 12 }} />
              <Shimmer height={78} style={{ marginTop: 12 }} />
            </>
          ) : failed && ideas.length === 0 ? (
            <LoadFailed title="Couldn’t load the ideas" onRetry={() => void load()} />
          ) : ideas.length === 0 ? (
            <EmptyState
              icon="sparkle"
              title={filtering ? 'No ideas match that' : 'No ideas yet'}
              body={filtering ? 'Try another word or filter, or suggest it yourself.' : 'Be the first to suggest something.'}
              actionLabel="Suggest an idea"
              onAction={() => setSuggest(true)}
            />
          ) : (
            <>
              {ideas.map((idea, i) => (
                <FadeIn key={idea.id} duration={240} delay={Math.min(i, 6) * 25}>
                  <IdeaRow idea={idea} onOpen={open} onVote={(x) => void vote(x)} />
                </FadeIn>
              ))}
              {more ? (
                <PrimaryButton label="Show more" onPress={() => void showMore()} busy={loadingMore} style={{ marginTop: 16 }} />
              ) : null}
            </>
          )}
        </View>
      </KeyboardScrollView>
      <IdeaSheet
        visible={suggest}
        onClose={() => setSuggest(false)}
        onPosted={(idea) => {
          void load();
          open(idea);
        }}
        onOpenIdea={open}
      />
    </Screen>
  );
}
