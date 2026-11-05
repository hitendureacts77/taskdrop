import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { listIdeas, postIdea } from '../data/extras';
import { KINDS, KIND_LABEL, compactCount, similarQuery, type Idea, type IdeaKind } from '../lib/ideas';
import { BottomSheet, Field, Pill, PrimaryButton } from './kit';
import { tx } from './primitives';
import { isNeedsAccount, useAccountHold } from '../lib/guest';

/**
 * "Suggest an idea": a title, what it is, and optional details. While the title
 * is typed, ideas that already say the same thing show underneath, so a person
 * can back one of those instead of starting a copy of it.
 */
export function IdeaSheet({
  visible,
  onClose,
  onPosted,
  onOpenIdea,
}: {
  visible: boolean;
  onClose: () => void;
  onPosted: (idea: Idea) => void;
  onOpenIdea: (idea: Idea) => void;
}) {
  // Steps aside while the account pop-up, or the sign-in page it opened, is showing.
  const held = useAccountHold();
  const t = useTheme();
  const { flash, celebrate } = useActions();
  const [kind, setKind] = useState<IdeaKind>('feature');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<Idea[]>([]);

  // Ideas that already say something like this, once the title has a real word in it.
  useEffect(() => {
    const q = similarQuery(title);
    if (!visible || !q) {
      setSimilar([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void listIdeas({ search: q, limit: 3 })
        .then((rows) => alive && setSimilar(rows))
        .catch(() => alive && setSimilar([]));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [title, visible]);

  const send = async () => {
    setBusy(true);
    try {
      const idea = await postIdea(title, body, kind);
      setTitle('');
      setBody('');
      setSimilar([]);
      onClose();
      onPosted(idea);
      celebrate('Thanks. Your idea is on the board');
    } catch (e) {
      if (isNeedsAccount(e)) return;
      flash(e instanceof Error ? e.message : 'Could not post that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible && !held}
      onClose={onClose}
      title="Suggest an idea"
      subtitle="Everyone using TaskDrop can see it and vote. Keep phone numbers and emails out. For a private problem, use Help & support."
      footer={<PrimaryButton label="Post idea" onPress={() => void send()} busy={busy} disabled={title.trim().length < 3} />}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {KINDS.map((k) => (
          <Pill key={k} label={KIND_LABEL[k]} active={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>
      <Field
        style={{ marginTop: 14 }}
        label="Short title"
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        placeholder="e.g. Let me save a favourite helper"
      />
      {similar.length ? (
        <View style={{ marginTop: 10 }}>
          <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1 })}>ALREADY SUGGESTED? BACK ONE OF THESE</RNText>
          {similar.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => {
                onClose();
                onOpenIdea(s);
              }}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                marginTop: 8,
                padding: 11,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: t.colors.line,
                backgroundColor: t.colors.surface,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <RNText style={tx('700', 13, t.colors.ink, { flex: 1 })} numberOfLines={1}>
                {s.title}
              </RNText>
              <RNText style={tx('800', 12, t.colors.accentDeep)}>{compactCount(s.votes)} votes</RNText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Field
        style={{ marginTop: 14 }}
        label="Details (optional)"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
        placeholder="What would it help you do?"
      />
    </BottomSheet>
  );
}
