import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  TextInput,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Image,
  ActivityIndicator,
  Linking,
  type ViewStyle,
} from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { Icon } from '../components/Icon';
import { BottomSheet, MenuRow } from '../components/kit';
import { AvatarPresence } from '../components/PresenceDot';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  CHAT_MEDIA_PREFIX,
  listMessages,
  sendMessage,
  subscribeToMessages,
  getTaskDetail,
  taskContactPhone,
  type Message as DbMessage,
  type Profile,
} from '../data/api';
import { pickMedia, signedMediaUrl, uploadMedia, MediaError } from '../lib/media';
import { findContactIssue } from '../lib/mask';
import { fontFamilyFor, type Theme } from '../theme';
import { tx } from '../components/primitives';

/**
 * Per-task chat: header with the other person and a call button, the task
 * strip, the thread (text and photos), and the composer.
 *
 * The thread itself opens when a quote is locked (the database decides that).
 * Contact details -- phone numbers, emails, links, addresses -- stay locked
 * until the work starts, the same moment names unmask everywhere else; before
 * then a message that carries one is stopped with the reason rather than sent.
 */

type Message =
  | { id: string; who: 'me' | 'them'; kind: 'text'; text: string }
  | { id: string; who: 'me' | 'them'; kind: 'image'; path: string };

/** Statuses from which contacts are unmasked for both sides. */
const OPEN_STATUSES = ['TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED', 'COMPLETED', 'AUTO_COMPLETED', 'DISPUTED'];

function bubbleShape(t: Theme, m: Message): { style: ViewStyle; textColor: string } {
  const mine = m.who === 'me';
  if (m.kind === 'image') {
    return {
      style: { alignSelf: mine ? 'flex-end' : 'flex-start', borderRadius: 16, overflow: 'hidden' },
      textColor: t.colors.muted,
    };
  }
  return {
    style: {
      alignSelf: mine ? 'flex-end' : 'flex-start',
      maxWidth: '78%',
      backgroundColor: mine ? t.colors.accent : t.colors.surface,
      borderWidth: mine ? 0 : 1,
      borderColor: t.colors.line,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      borderBottomRightRadius: mine ? 6 : 18,
      borderBottomLeftRadius: mine ? 18 : 6,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    textColor: mine ? t.colors.onAccent : t.colors.ink,
  };
}

/** A photo in the thread, signed on demand like every other private file. */
function ChatPhoto({ path }: { path: string }) {
  const t = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void signedMediaUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return (
    <View style={{ width: 200, height: 150, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: 200, height: 150 }} resizeMode="cover" accessibilityLabel="Photo" />
      ) : (
        <ActivityIndicator color={t.colors.accent} />
      )}
    </View>
  );
}

export function ChatScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const { mode } = useMode();
  const { openTask, flash } = useApp();
  const { userId } = useAuth();
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  const title = typeof params.title === 'string' ? params.title : (openTask?.title ?? 'Task');

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [other, setOther] = useState<Profile | null>(null);
  const [escrowMinor, setEscrowMinor] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [calling, setCalling] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const contactsOpen = status !== null && OPEN_STATUSES.includes(status);
  const counterpartyName = other?.display_name ?? (mode === 'worker' ? 'The customer' : 'The worker');
  const rating =
    other && (mode === 'worker' ? other.poster_rating_count : other.worker_rating_count) > 0
      ? Number(mode === 'worker' ? other.poster_rating_avg : other.worker_rating_avg).toFixed(1)
      : null;

  const toBubble = (m: DbMessage): Message =>
    m.body.startsWith(CHAT_MEDIA_PREFIX)
      ? { id: m.id, who: m.sender_id === userId ? 'me' : 'them', kind: 'image', path: m.body.slice(CHAT_MEDIA_PREFIX.length) }
      : { id: m.id, who: m.sender_id === userId ? 'me' : 'them', kind: 'text', text: m.body };

  useEffect(() => {
    if (!taskId || !userId) return;
    let alive = true;

    void (async () => {
      try {
        const [rows, detail] = await Promise.all([listMessages(taskId), getTaskDetail(taskId)]);
        if (!alive) return;
        setMessages(rows.map(toBubble));
        setOther(detail ? (detail.task.poster_id === userId ? detail.worker : detail.poster) : null);
        setEscrowMinor(detail?.assignment?.escrow_minor ?? null);
        setStatus(detail?.task.status ?? null);
      } catch (e) {
        if (alive) flash(e instanceof Error ? e.message : 'Could not open this chat');
      }
    })();

    // Both sides see new messages without polling.
    const unsubscribe = subscribeToMessages(taskId, (m) => {
      if (!alive) return;
      setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, toBubble(m)]));
    });

    return () => {
      alive = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, userId]);

  const post = async (body: string) => {
    if (!taskId || !userId) {
      flash('Open this chat from the task to send a message');
      return false;
    }
    const saved = await sendMessage(taskId, userId, body);
    setMessages((prev) => (prev.some((p) => p.id === saved.id) ? prev : [...prev, toBubble(saved)]));
    return true;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    // Until the work starts, contact details stay inside TaskDrop.
    if (!contactsOpen) {
      const issue = findContactIssue(text);
      if (issue) {
        setWarning(
          issue === 'address'
            ? 'Addresses can’t be shared yet. The exact location unlocks when the work starts.'
            : 'Phone numbers, emails, links and chat handles can’t be shared until the work starts. Keep talking here — it keeps your payment protected.',
        );
        return;
      }
    }
    setWarning(null);
    setSending(true);
    setDraft('');
    try {
      await post(text);
    } catch (e) {
      setDraft(text); // hand the text back rather than losing it
      flash(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  const sendPhoto = async (source: 'camera' | 'library') => {
    setAttachOpen(false);
    try {
      const picked = await pickMedia('image', source);
      if (!picked) return;
      setUploading(true);
      const uploaded = await uploadMedia(picked);
      await post(CHAT_MEDIA_PREFIX + uploaded.path);
    } catch (e) {
      flash(e instanceof MediaError || e instanceof Error ? e.message : 'Could not send that photo');
    } finally {
      setUploading(false);
    }
  };

  const call = async () => {
    if (!taskId) return;
    if (!contactsOpen) {
      flash('Calling unlocks when the work starts. Until then, chat here.');
      return;
    }
    setCalling(true);
    try {
      const phone = await taskContactPhone(taskId);
      if (!phone) {
        flash(`${counterpartyName} signed up without a phone number. Chat here instead.`);
        return;
      }
      await Linking.openURL(`tel:${phone}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not start the call');
    } finally {
      setCalling(false);
    }
  };

  const round = {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  } as const;

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
        {/* ---- header ---- */}
        <View
          style={{
            backgroundColor: t.colors.surface,
            paddingHorizontal: 14,
            paddingTop: 6,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          }}
        >
          <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={round}>
            <Icon name="back" size={20} color={t.colors.ink} />
          </Pressable>
          <Pressable
            onPress={() => other && go('publicProfile', { userId: other.id, role: mode === 'worker' ? 'poster' : 'worker' })}
            accessibilityRole="button"
            accessibilityLabel={`${counterpartyName}'s profile`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}
          >
            <View>
              <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.purpleDeep, alignItems: 'center', justifyContent: 'center' }}>
                <RNText style={tx('800', 16, '#FFFFFF')}>{counterpartyName.charAt(0).toUpperCase()}</RNText>
              </View>
              <AvatarPresence lastSeen={other?.last_seen_at} ring={t.colors.surface} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <RNText style={tx('800', 15, t.colors.ink, { flexShrink: 1 })} numberOfLines={1}>
                  {counterpartyName}
                </RNText>
                {rating ? <RNText style={tx('600', 12, t.colors.goldInk)}>★ {rating}</RNText> : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <Icon name={contactsOpen ? 'check' : 'lock'} size={11} color={contactsOpen ? t.colors.accentDeep : t.colors.muted} />
                <RNText style={tx('600', 11, contactsOpen ? t.colors.accentDeep : t.colors.muted)} numberOfLines={1}>
                  {contactsOpen ? 'Contacts unlocked' : 'Contacts unlock when work starts'}
                </RNText>
              </View>
            </View>
          </Pressable>
          <Pressable
            onPress={() => void call()}
            accessibilityRole="button"
            accessibilityLabel={`Call ${counterpartyName}`}
            style={({ pressed }) => ({
              ...round,
              backgroundColor: contactsOpen ? t.colors.accentSoft : t.colors.surface2,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            {calling ? (
              <ActivityIndicator size="small" color={t.colors.accent} />
            ) : (
              <Icon name="phone" size={18} color={contactsOpen ? t.colors.accentDeep : t.colors.muted} />
            )}
          </Pressable>
        </View>

        {/* ---- the task this thread is about ---- */}
        <Pressable
          onPress={() => taskId && go('active', { ...params, taskId, title })}
          accessibilityRole="button"
          accessibilityLabel="Open the task"
          style={({ pressed }) => ({
            backgroundColor: pressed ? t.colors.surface2 : t.colors.surface,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
            paddingVertical: 11,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
          })}
        >
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="briefcase" size={16} color={t.colors.accentDeep} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <RNText style={tx('700', 13, t.colors.ink)} numberOfLines={1}>
              {title}
            </RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2, fontVariant: ['tabular-nums'] })}>
              {escrowMinor !== null ? `${formatINR(escrowMinor)} · held safely` : 'Your payment is held safely'}
            </RNText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <RNText style={tx('700', 12, t.colors.accentDeep)}>View task</RNText>
            <Icon name="chevronRight" size={14} color={t.colors.accentDeep} />
          </View>
        </Pressable>

        {/* ---- thread ---- */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, backgroundColor: t.colors.bg }}
          contentContainerStyle={{ paddingVertical: 16, paddingHorizontal: 16, gap: 8 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          <View
            style={{
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: contactsOpen ? t.colors.accentSoft : t.colors.surface,
              borderWidth: 1,
              borderColor: contactsOpen ? t.colors.accentBorder : t.colors.line,
              borderRadius: 12,
              paddingVertical: 9,
              paddingHorizontal: 13,
              maxWidth: '92%',
              marginBottom: 6,
            }}
          >
            <Icon name="shield" size={14} color={contactsOpen ? t.colors.accentDeep : t.colors.muted} />
            <RNText style={tx('500', 11.5, contactsOpen ? t.colors.accentDeep : t.colors.text, { lineHeight: 16, flexShrink: 1 })}>
              {contactsOpen
                ? 'The work has started. Contacts are unlocked for both of you — you can call from the top.'
                : 'Your offer was accepted. Phone numbers, emails and addresses unlock when the work starts, so your payment stays protected.'}
            </RNText>
          </View>

          {messages.map((m) => {
            const { style, textColor } = bubbleShape(t, m);
            if (m.kind === 'image') {
              return (
                <View key={m.id} style={style}>
                  <ChatPhoto path={m.path} />
                </View>
              );
            }
            return (
              <View key={m.id} style={style}>
                <RNText style={tx(m.who === 'me' ? '500' : '400', 14, textColor, { lineHeight: 20 })}>{m.text}</RNText>
              </View>
            );
          })}
          {uploading ? (
            <View style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 }}>
              <ActivityIndicator size="small" color={t.colors.accent} />
              <RNText style={tx('600', 12, t.colors.muted)}>Sending photo…</RNText>
            </View>
          ) : null}
        </ScrollView>

        {warning ? (
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: t.colors.signalSoft }}>
            <Icon name="shield" size={15} color={t.colors.signalDeep} />
            <RNText style={tx('600', 12, t.colors.signalDeep, { flex: 1, lineHeight: 17 })}>{warning}</RNText>
            <Pressable onPress={() => setWarning(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss">
              <Icon name="close" size={15} color={t.colors.signalDeep} />
            </Pressable>
          </View>
        ) : null}

        {/* ---- composer ---- */}
        <View
          style={{
            backgroundColor: t.colors.surface,
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: 18,
            borderTopWidth: 1,
            borderTopColor: t.colors.line,
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 8,
          }}
        >
          <Pressable
            onPress={() => setAttachOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo"
            style={({ pressed }) => ({ ...round, backgroundColor: t.colors.surface2, transform: [{ scale: pressed ? 0.94 : 1 }] })}
          >
            <Icon name="plus" size={20} color={t.colors.ink} />
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={(v) => {
              setDraft(v);
              if (warning) setWarning(null);
            }}
            placeholder="Type a message"
            placeholderTextColor={t.colors.muted}
            multiline
            style={{
              flex: 1,
              backgroundColor: t.colors.surface2,
              borderRadius: 20,
              paddingTop: 11,
              paddingBottom: 11,
              paddingHorizontal: 16,
              color: t.colors.ink,
              fontFamily: fontFamilyFor('400'),
              fontSize: 14,
              maxHeight: 110,
            }}
          />
          <Pressable
            onPress={() => void send()}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => ({
              ...round,
              backgroundColor: draft.trim() ? t.colors.accent : t.colors.surface2,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            {sending ? (
              <ActivityIndicator size="small" color={t.colors.onAccent} />
            ) : (
              <Icon name="send" size={18} color={draft.trim() ? t.colors.onAccent : t.colors.muted} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <BottomSheet visible={attachOpen} onClose={() => setAttachOpen(false)} title="Send a photo" subtitle="Show the job, a part, or the finished work.">
        <MenuRow icon="eye" label="Take a photo" sub="Use the camera" onPress={() => void sendPhoto('camera')} />
        <MenuRow icon="copy" label="Choose from gallery" sub="Pick a photo you already have" onPress={() => void sendPhoto('library')} />
      </BottomSheet>
    </Screen>
  );
}
