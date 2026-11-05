import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, TextInput, Pressable, KeyboardAvoidingView } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { VoteBox } from '../components/IdeaRow';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { KeyboardScrollView } from '../components/KeyboardScrollView';
import { Badge, EmptyState, LoadFailed, Shimmer, TopBar, timeAgo } from '../components/kit';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { commentOnIdea, getIdea, voteIdea } from '../data/extras';
import {
  KIND_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  withVote,
  withVoteResult,
  type Idea,
  type IdeaComment,
} from '../lib/ideas';
import { reportError } from '../lib/errors';
import { isNeedsAccount } from '../lib/guest';

/** One idea on the board: its text, where it stands, the vote, and the conversation under it. */
export function IdeaDetailScreen() {
  const t = useTheme();
  const { back, params } = useNav();
  const { flash } = useActions();
  const ideaId = typeof params.ideaId === 'string' ? params.ideaId : null;
  const [idea, setIdea] = useState<Idea | null>(null);
  const [comments, setComments] = useState<IdeaComment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'failed'>('loading');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ideaId) return setState('gone');
    try {
      const r = await getIdea(ideaId);
      if (!r) return setState('gone');
      setIdea(r.post);
      setComments(r.comments);
      setState('ready');
    } catch (e) {
      reportError(e, 'ideas.detail');
      setState('failed');
    }
  }, [ideaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const vote = async (current: Idea) => {
    const on = !current.iVoted;
    setIdea((i) => (i ? withVote(i, on) : i));
    try {
      const r = await voteIdea(current.id, on);
      setIdea((i) => (i ? withVoteResult(i, r) : i));
    } catch (e) {
      setIdea((i) => (i ? withVote(i, !on) : i));
      if (isNeedsAccount(e)) return;
      flash(e instanceof Error ? e.message : 'Could not save your vote');
    }
  };

  const send = async () => {
    if (!idea || !draft.trim()) return;
    setBusy(true);
    try {
      const c = await commentOnIdea(idea.id, draft);
      setComments((cur) => [...cur, c]);
      setIdea((i) => (i ? { ...i, comments: i.comments + 1 } : i));
      setDraft('');
    } catch (e) {
      if (isNeedsAccount(e)) return;
      flash(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <TopBar title="Idea" onBack={back} />
        <KeyboardScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          {state === 'loading' ? (
            <>
              <Shimmer height={28} style={{ marginTop: 4 }} />
              <Shimmer height={90} style={{ marginTop: 14 }} />
            </>
          ) : state === 'failed' ? (
            <LoadFailed onRetry={() => void load()} />
          ) : state === 'gone' || !idea ? (
            <EmptyState icon="sparkle" title="This idea is no longer on the board" body="It may have been removed by the team." actionLabel="Back to ideas" onAction={back} />
          ) : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Badge label={STATUS_LABEL[idea.status]} tone={STATUS_TONE[idea.status]} />
                <RNText style={tx('600', 12, t.colors.muted)}>{KIND_LABEL[idea.category]}</RNText>
              </View>
              <RNText style={tx('800', 22, t.colors.ink, { marginTop: 10, letterSpacing: -0.5, lineHeight: 28 })}>{idea.title}</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6 })}>
                {idea.mine ? 'You' : idea.author} · {timeAgo(idea.createdAt)}
              </RNText>
              {idea.body ? <RNText style={tx('400', 15, t.colors.ink, { marginTop: 14, lineHeight: 23 })}>{idea.body}</RNText> : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 }}>
                <VoteBox idea={idea} onVote={(x) => void vote(x)} wide />
                <RNText style={tx('400', 12, t.colors.muted, { flex: 1, lineHeight: 17 })}>
                  {idea.iVoted ? 'You backed this. We will tell you when it moves.' : 'Back it, and we will tell you when it moves.'}
                </RNText>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 26 }}>
                <Icon name="chat" size={16} color={t.colors.ink} />
                <RNText style={tx('800', 16, t.colors.ink)}>
                  {idea.comments === 0 ? 'Comments' : `Comments (${idea.comments})`}
                </RNText>
              </View>
              {comments.length === 0 ? (
                <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10, lineHeight: 19 })}>
                  No comments yet. Say how this would help you.
                </RNText>
              ) : (
                comments.map((c, i) => (
                  <FadeIn key={c.id} duration={240} delay={Math.min(i, 6) * 25}>
                    <View
                      style={{
                        marginTop: 10,
                        padding: 12,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: c.isTeam ? t.colors.accentBorder : t.colors.line,
                        backgroundColor: c.isTeam ? t.colors.accentSoft : t.colors.surface,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <RNText style={tx('700', 12, c.isTeam ? t.colors.accentDeep : t.colors.ink)}>{c.mine ? 'You' : c.author}</RNText>
                        {c.isTeam ? <Icon name="check" size={12} color={t.colors.accentDeep} strokeWidth={2.4} /> : null}
                        <RNText style={tx('400', 11, t.colors.muted)}>{timeAgo(c.createdAt)}</RNText>
                      </View>
                      <RNText style={tx('400', 14, t.colors.ink, { marginTop: 4, lineHeight: 20 })}>{c.body}</RNText>
                    </View>
                  </FadeIn>
                ))
              )}
            </>
          )}
        </KeyboardScrollView>
        {state === 'ready' && idea ? (
          <KeyboardSafe style={{ paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.colors.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Add a comment"
                placeholderTextColor={t.colors.muted}
                multiline
                maxLength={1000}
                accessibilityLabel="Add a comment"
                style={{
                  flex: 1,
                  minHeight: 44,
                  maxHeight: 120,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  backgroundColor: t.colors.surface,
                  color: t.colors.ink,
                  fontSize: 14,
                }}
              />
              <Pressable
                onPress={() => void send()}
                disabled={busy || !draft.trim()}
                accessibilityRole="button"
                accessibilityLabel="Send comment"
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  backgroundColor: draft.trim() ? t.colors.accent : t.colors.surface2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="send" size={18} color={draft.trim() ? t.colors.onAccent : t.colors.muted} />
              </Pressable>
            </View>
          </KeyboardSafe>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}
