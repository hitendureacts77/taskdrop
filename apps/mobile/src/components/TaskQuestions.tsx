import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, TextInput, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useActions } from '../providers/AppStateProvider';
import { answerTaskQuestion, askTaskQuestion, listTaskQuestions, type TaskQuestion } from '../data/extras';
import { cardSurface } from './ui';
import { Icon } from './Icon';
import { timeAgo } from './kit';
import { Pressy, tx } from './primitives';
import { isNeedsAccount } from '../lib/guest';

/**
 * Questions on a task (plan item 1, migration 140). Workers ask before they
 * offer; the poster answers once and everyone looking at the task sees it, so
 * the same thing is not asked five times. The server refuses phone numbers,
 * emails and links, because contacts unlock only when the work starts.
 *
 * role "ask": the worker's task page, between the privacy line and Your offer.
 * role "answer": the poster's task page, above Activity timeline; shown only
 * once someone has asked.
 *
 * Draws nothing when the questions cannot be read (or are not switched on yet).
 */
export function TaskQuestions({
  taskId,
  role,
  posterName,
  style,
}: {
  taskId: string;
  role: 'ask' | 'answer';
  /** First name shown on answers, for the worker's view. */
  posterName?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const { flash } = useActions();
  const [list, setList] = useState<TaskQuestion[] | null>(null);
  const [draft, setDraft] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => setList(await listTaskQuestions(taskId)), [taskId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (list === null) return null;
  if (role === 'answer' && list.length === 0) return null;

  const ask = async () => {
    const body = draft.trim();
    if (body.length < 3) return flash('Write your question first');
    setBusy('ask');
    try {
      const q = await askTaskQuestion(taskId, body);
      setList((cur) => [...(cur ?? []), q]);
      setDraft('');
      flash('Question sent. You will get an alert when it is answered');
    } catch (e) {
      if (isNeedsAccount(e)) return;
      flash(e instanceof Error ? e.message : 'Could not send your question');
    } finally {
      setBusy(null);
    }
  };

  const answer = async (q: TaskQuestion) => {
    const text = (answers[q.id] ?? '').trim();
    if (!text) return flash('Write your answer first');
    setBusy(q.id);
    try {
      const done = await answerTaskQuestion(q.id, text);
      setList((cur) => (cur ?? []).map((x) => (x.id === q.id ? { ...x, answer: done.answer, answeredAt: done.answeredAt } : x)));
      setAnswers((cur) => ({ ...cur, [q.id]: '' }));
    } catch (e) {
      if (isNeedsAccount(e)) return;
      flash(e instanceof Error ? e.message : 'Could not save your answer');
    } finally {
      setBusy(null);
    }
  };

  const unanswered = list.filter((q) => !q.answer).length;
  const answerer = role === 'answer' ? 'You' : (posterName?.trim().split(/\s+/)[0] || 'Answer');
  const field = (value: string, onChange: (v: string) => void, placeholder: string, label: string, max: number) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      maxLength={max}
      placeholder={placeholder}
      placeholderTextColor={t.colors.muted}
      accessibilityLabel={label}
      style={tx('400', 14, t.colors.ink, {
        flex: 1,
        height: 46,
        paddingHorizontal: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: t.colors.line,
        backgroundColor: t.colors.bg,
        ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
      })}
    />
  );

  return (
    <View style={[{ ...cardSurface(t, 18), padding: 16 }, style]}>
      {role === 'answer' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="help" size={16} color={t.colors.accentDeep} />
          <RNText style={tx('800', 15, t.colors.ink, { flex: 1 })}>Questions from workers</RNText>
          {unanswered > 0 ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: t.colors.signalSoft }}>
              <RNText style={tx('800', 12, t.colors.signalDeep)}>{unanswered} new</RNText>
            </View>
          ) : null}
        </View>
      ) : (
        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>
          {list.length > 0 ? `QUESTIONS · ${list.length}` : 'QUESTIONS'}
        </RNText>
      )}

      {list.map((q) => (
        <View key={q.id} style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}>
          <RNText style={tx('700', 15, t.colors.ink, { lineHeight: 21 })}>{q.body}</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
            {q.mine ? 'You' : q.asker} · {timeAgo(q.createdAt)}
          </RNText>
          {q.answer ? (
            <View style={{ marginTop: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: t.colors.surface2 }}>
              <RNText style={tx('400', 14, t.colors.text, { lineHeight: 20 })}>
                <RNText style={tx('700', 14, t.colors.ink)}>{answerer}:</RNText> {q.answer}
              </RNText>
            </View>
          ) : role === 'answer' ? (
            <View style={{ marginTop: 10, flexDirection: 'row', gap: 8 }}>
              {field(answers[q.id] ?? '', (v) => setAnswers((cur) => ({ ...cur, [q.id]: v })), 'Answer for everyone to see', 'Your answer', 500)}
              <Pressy
                onPress={() => void answer(q)}
                disabled={busy === q.id}
                style={{ height: 46, paddingHorizontal: 16, borderRadius: 14, backgroundColor: t.colors.btn, justifyContent: 'center', opacity: busy === q.id ? 0.6 : 1 }}
              >
                <RNText style={tx('800', 15, t.colors.onBtn)}>Answer</RNText>
              </Pressy>
            </View>
          ) : (
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6 })}>Not answered yet</RNText>
          )}
        </View>
      ))}

      {role === 'ask' ? (
        <>
          <RNText style={tx('700', 14, t.colors.ink, { marginTop: 14 })}>Ask before you offer</RNText>
          <View style={{ marginTop: 8, flexDirection: 'row', gap: 8 }}>
            {field(draft, setDraft, 'Something you need to know to price it', 'Your question', 300)}
            <Pressy
              onPress={() => void ask()}
              disabled={busy === 'ask'}
              label="Send question"
              style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: t.colors.purple, alignItems: 'center', justifyContent: 'center', opacity: busy === 'ask' ? 0.6 : 1 }}
            >
              <Icon name="send" size={18} color={t.colors.bg} strokeWidth={2} />
            </Pressy>
          </View>
        </>
      ) : null}

      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 10, lineHeight: 17 })}>
        {role === 'ask'
          ? 'Everyone sees questions and answers. Phone numbers, emails and links are removed.'
          : 'Answers are public. Never share your phone number or exact address here.'}
      </RNText>
    </View>
  );
}
