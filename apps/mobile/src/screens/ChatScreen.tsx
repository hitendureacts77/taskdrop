import { useEffect, useState } from 'react';
import {
  View,
  Text as RNText,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  type ViewStyle,
} from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  listMessages,
  sendMessage,
  subscribeToMessages,
  getTaskDetail,
  type Message as DbMessage,
} from '../data/api';
import { fontFamilyFor, type Theme } from '../theme';
import { tx } from '../components/primitives';

/**
 * Chat — pixel parity with docs/design/_design_markup.html lines 915-963
 * (header with escrow/contact-revealed, task strip, text/image/voice
 * bubbles, input bar). Data/handlers mirror docs/design/_design_source.jsx
 * lines 787-810 (chatMsgs seed + bubble shapes, sendChat).
 */

type Message =
  | { id: string; who: 'me' | 'them'; kind: 'text'; text: string }
  | { id: string; who: 'me' | 'them'; kind: 'image' }
  | { id: string; who: 'me' | 'them'; kind: 'voice'; duration: string };

// Seed reproduced verbatim from _design_source.jsx lines 792-796.
const SEED: Message[] = [
  { id: 'm1', who: 'them', kind: 'text', text: 'I have the K1000 tested and ready. Want a photo of the shutter curtain?' },
  { id: 'm2', who: 'me', kind: 'text', text: 'Yes please, and the lens front element.' },
  { id: 'm3', who: 'them', kind: 'image' },
  { id: 'm4', who: 'them', kind: 'voice', duration: '0:12' },
];

const FALLBACK_TASK = {
  worker: { title: 'Vintage 35mm film camera', escrow: '₹4,326' },
  poster: { title: 'Assemble a wardrobe', escrow: '₹1,236' },
} as const;

/** Bubble shape per _design_source.jsx lines 802-808. */
function bubbleShape(t: Theme, m: Message): { style: ViewStyle; textColor: string } {
  if (m.kind === 'image') {
    return {
      style: {
        alignSelf: 'flex-start',
        width: 158,
        height: 108,
        borderRadius: 16,
        backgroundColor: t.colors.surface2,
        alignItems: 'center',
        justifyContent: 'center',
      },
      textColor: t.colors.muted,
    };
  }
  if (m.kind === 'voice') {
    return {
      style: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        backgroundColor: t.colors.surface2,
        borderRadius: 999,
        paddingVertical: 11,
        paddingHorizontal: 16,
      },
      textColor: t.colors.ink,
    };
  }
  if (m.who === 'me') {
    return {
      style: {
        alignSelf: 'flex-end',
        maxWidth: '76%',
        backgroundColor: t.colors.accent,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomRightRadius: 5,
        borderBottomLeftRadius: 16,
        paddingVertical: 11,
        paddingHorizontal: 14,
      },
      textColor: t.colors.onAccent,
    };
  }
  return {
    style: {
      alignSelf: 'flex-start',
      maxWidth: '76%',
      backgroundColor: t.colors.surface2,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderBottomRightRadius: 16,
      borderBottomLeftRadius: 5,
      paddingVertical: 11,
      paddingHorizontal: 14,
    },
    textColor: t.colors.ink,
  };
}

/** Per-task chat — header, escrow strip, bubbles, input bar. */
export function ChatScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const { mode } = useMode();
  const { openTask, flash } = useApp();

  const fallback = FALLBACK_TASK[mode];
  const title = typeof params.title === 'string' ? params.title : (openTask?.title ?? fallback.title);

  const { userId } = useAuth();
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;

  // Without a task there is no thread to load, so the design's sample
  // conversation stands in and the composer says why it can't send.
  const [messages, setMessages] = useState<Message[]>(taskId ? [] : SEED);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [otherName, setOtherName] = useState<string | null>(null);
  const [escrowMinor, setEscrowMinor] = useState<number | null>(null);

  const escrowStr =
    escrowMinor !== null ? formatINR(escrowMinor) : (openTask?.escrow ?? fallback.escrow);

  // Whoever is actually on the other side of this task.
  const counterpartyName = otherName ?? (mode === 'worker' ? 'The poster' : 'The worker');

  const toBubble = (m: DbMessage): Message => ({
    id: m.id,
    who: m.sender_id === userId ? 'me' : 'them',
    kind: 'text',
    text: m.body,
  });

  useEffect(() => {
    if (!taskId || !userId) return;
    let alive = true;

    void (async () => {
      try {
        const [rows, detail] = await Promise.all([listMessages(taskId), getTaskDetail(taskId)]);
        if (!alive) return;
        setMessages(rows.map(toBubble));
        const other = detail
          ? detail.task.poster_id === userId
            ? detail.worker
            : detail.poster
          : null;
        setOtherName(other?.display_name ?? null);
        setEscrowMinor(detail?.assignment?.escrow_minor ?? null);
      } catch (e) {
        if (alive) flash(e instanceof Error ? e.message : 'Could not open this chat');
      }
    })();

    // Both sides see new messages without polling.
    const unsubscribe = subscribeToMessages(taskId, (m) => {
      if (!alive) return;
      // Our own insert already landed optimistically; don't double it.
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, toBubble(m)]));
    });

    return () => {
      alive = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, userId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (!taskId || !userId) {
      flash('Open this chat from the task to send a message');
      return;
    }
    setSending(true);
    setDraft('');
    try {
      const saved = await sendMessage(taskId, userId, text);
      setMessages((prev) => (prev.some((p) => p.id === saved.id) ? prev : [...prev, toBubble(saved)]));
    } catch (e) {
      setDraft(text); // hand the text back rather than losing it
      flash(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <View
          style={{
            backgroundColor: t.colors.surface,
            paddingHorizontal: 18,
            paddingTop: 6,
            paddingBottom: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          }}
        >
          <Pressable onPress={back} hitSlop={10}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              backgroundColor: t.colors.surface2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('400', 15, t.colors.muted)}>☺</RNText>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <RNText style={tx('700', 15, t.colors.ink)} numberOfLines={1}>
                {counterpartyName}
              </RNText>
              <RNText style={tx('400', 12, t.colors.muted, { fontVariant: ['tabular-nums'] })}>★ 4.9</RNText>
            </View>
            <RNText style={tx('400', 11, t.colors.accentDeep, { marginTop: 2 })}>Contact revealed</RNText>
          </View>
          <RNText style={tx('400', 17, t.colors.ink)}>☏</RNText>
        </View>

        <Pressable
          onPress={() => go('active', params)}
          style={{
            backgroundColor: t.colors.surface,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
            paddingVertical: 12,
            paddingHorizontal: 18,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              backgroundColor: t.colors.surface2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('400', 13, t.colors.muted)}>▤</RNText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <RNText style={tx('700', 13, t.colors.ink)} numberOfLines={1}>
              {title}
            </RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2, fontVariant: ['tabular-nums'] })}>
              {escrowStr} · in escrow
            </RNText>
          </View>
          <RNText style={tx('700', 12, t.colors.accentDeep)}>View</RNText>
        </Pressable>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 18, gap: 11 }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              alignSelf: 'center',
              backgroundColor: t.colors.accentSoft,
              borderWidth: 1,
              borderColor: t.colors.accentBorder,
              borderRadius: 10,
              paddingVertical: 9,
              paddingHorizontal: 14,
            }}
          >
            <RNText style={tx('400', 11, t.colors.accentDeep, { lineHeight: 16, textAlign: 'center' })}>
              Chat opened when the task started.{'\n'}Contacts unmasked for both sides.
            </RNText>
          </View>

          {messages.map((m) => {
            const { style, textColor } = bubbleShape(t, m);
            if (m.kind === 'image') {
              return (
                <View key={m.id} style={style}>
                  <RNText style={{ fontSize: 18, color: textColor }}>▤</RNText>
                </View>
              );
            }
            if (m.kind === 'voice') {
              return (
                <View key={m.id} style={style}>
                  <RNText style={tx('400', 13, textColor)}>▶</RNText>
                  <View style={{ width: 74, height: 3, backgroundColor: t.colors.line, borderRadius: 999 }} />
                  <RNText style={tx('400', 12, t.colors.muted, { fontVariant: ['tabular-nums'] })}>
                    {m.duration}
                  </RNText>
                </View>
              );
            }
            return (
              <View key={m.id} style={style}>
                <RNText style={tx(m.who === 'me' ? '500' : '400', 14, textColor, { lineHeight: 20 })}>
                  {m.text}
                </RNText>
              </View>
            );
          })}
        </ScrollView>

        <View
          style={{
            backgroundColor: t.colors.surface,
            paddingHorizontal: 18,
            paddingTop: 12,
            paddingBottom: 22,
            borderTopWidth: 1,
            borderTopColor: t.colors.line,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <RNText style={tx('400', 20, t.colors.muted)}>+</RNText>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void send()}
            returnKeyType="send"
            blurOnSubmit={false}
            placeholder="Type a message"
            placeholderTextColor={t.colors.muted}
            multiline
            style={{
              flex: 1,
              backgroundColor: t.colors.surface2,
              borderRadius: 999,
              paddingVertical: 12,
              paddingHorizontal: 16,
              color: t.colors.ink,
              fontFamily: fontFamilyFor('400'),
              fontSize: 14,
              maxHeight: 100,
            }}
          />
          <Pressable onPress={send} hitSlop={8}>
            <RNText style={tx('700', 15, t.colors.accentDeep)}>Send</RNText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
