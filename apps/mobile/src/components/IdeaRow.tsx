import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import { Badge, timeAgo } from './kit';
import { tx } from './primitives';
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, compactCount, type Idea } from '../lib/ideas';

/** The little box with an arrow and a count: tap to back an idea, tap again to take it back. */
export function VoteBox({ idea, onVote, wide }: { idea: Idea; onVote: (idea: Idea) => void; wide?: boolean }) {
  const t = useTheme();
  const on = idea.iVoted;
  return (
    <Pressable
      onPress={() => onVote(idea)}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${on ? 'Take back your vote' : 'Vote for this idea'}. ${idea.votes} ${idea.votes === 1 ? 'vote' : 'votes'}`}
      hitSlop={6}
      style={({ pressed }) => ({
        width: wide ? undefined : 48,
        minWidth: 48,
        paddingHorizontal: wide ? 14 : 0,
        height: wide ? 44 : 52,
        flexDirection: wide ? 'row' : 'column',
        gap: wide ? 8 : 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: on ? t.colors.accent : t.colors.line,
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {/* The back arrow turned a quarter: points up. */}
      <View style={{ transform: [{ rotate: '90deg' }] }}>
        <Icon name="back" size={16} color={on ? t.colors.accentDeep : t.colors.muted} strokeWidth={2.2} />
      </View>
      <RNText style={tx('800', 14, on ? t.colors.accentDeep : t.colors.ink)}>{compactCount(idea.votes)}</RNText>
    </Pressable>
  );
}

/** One idea on the board: what it says, where it stands, and the box to vote. */
export function IdeaRow({ idea, onOpen, onVote }: { idea: Idea; onOpen: (idea: Idea) => void; onVote: (idea: Idea) => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onOpen(idea)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 2,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.line,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <RNText style={tx('800', 15, t.colors.ink, { lineHeight: 21 })} numberOfLines={2}>
          {idea.title}
        </RNText>
        {idea.body ? (
          <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4, lineHeight: 19 })} numberOfLines={2}>
            {idea.body}
          </RNText>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 9 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="chat" size={13} color={t.colors.muted} />
            <RNText style={tx('600', 12, t.colors.muted)}>{idea.comments}</RNText>
          </View>
          {idea.status !== 'open' ? <Badge label={STATUS_LABEL[idea.status]} tone={STATUS_TONE[idea.status]} /> : null}
          <RNText style={tx('400', 12, t.colors.muted)} numberOfLines={1}>
            {KIND_LABEL[idea.category]} · {idea.mine ? 'You' : idea.author} · {timeAgo(idea.createdAt)}
          </RNText>
        </View>
      </View>
      <VoteBox idea={idea} onVote={onVote} />
    </Pressable>
  );
}
