import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, TextInput, KeyboardAvoidingView } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { Badge, EmptyState, Field, Pill, PrimaryButton, Shimmer, TopBar, timeAgo } from '../components/kit';
import { FeedbackSheet } from '../components/FeedbackSheet';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import {
  TICKET_CATEGORIES,
  getTicket,
  listTickets,
  openTicket,
  replyTicket,
  resolveTicket,
  type Ticket,
  type TicketCategory,
  type TicketMessage,
} from '../data/extras';

const STATUS: Record<string, { label: string; tone: 'gold' | 'accent' | 'neutral' }> = {
  waiting: { label: 'Waiting for support', tone: 'gold' },
  answered: { label: 'Support replied', tone: 'accent' },
  resolved: { label: 'Resolved', tone: 'neutral' },
};

/**
 * Help & support: start a conversation with the team, and see the ones
 * already open. Replies from the team arrive as a notification and in the
 * thread (reply_support_ticket, from an admin account).
 */
export function HelpScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { flash, celebrate } = useActions();
  const [category, setCategory] = useState<TicketCategory>('payment');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [feedback, setFeedback] = useState(false);

  const load = useCallback(async () => setTickets(await listTickets()), []);
  useEffect(() => {
    void load().catch(() => setTickets([]));
  }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      const ticket = await openTicket(category, body, 'help');
      setBody('');
      celebrate('Sent — we’ll reply here');
      await load();
      go('ticket', { ticketId: ticket.id });
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  };

  const open = (tickets ?? []).filter((x) => x.status !== 'resolved');
  const done = (tickets ?? []).filter((x) => x.status === 'resolved');

  return (
    <Screen padded={false}>
      <TopBar title="Help & support" onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
        <RNText style={tx('600', 11, t.colors.accentDeep, { letterSpacing: 1.3 })}>WHAT DO YOU NEED HELP WITH?</RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
          {TICKET_CATEGORIES.map((c) => (
            <Pill key={c.key} label={c.label} active={category === c.key} onPress={() => setCategory(c.key)} />
          ))}
        </View>
        <Field
          style={{ marginTop: 14 }}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={4000}
          placeholder="Tell us what happened"
          hint="Include the task name or amount if it is about a payment."
        />
        <PrimaryButton label="Send message" onPress={() => void send()} busy={busy} disabled={body.trim().length < 5} style={{ marginTop: 14 }} />
        <Pressable onPress={() => setFeedback(true)} style={{ marginTop: 12 }} accessibilityRole="button">
          <RNText style={tx('400', 12, t.colors.muted, { lineHeight: 18 })}>
            Not stuck, just have an idea or found a bug? <RNText style={tx('700', 12, t.colors.accentDeep)}>Send feedback</RNText> instead — it goes to the team that builds TaskDrop.
          </RNText>
        </Pressable>

        <Pressable
          onPress={() => go('pricing')}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: 18,
            padding: 13,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.colors.line,
            backgroundColor: t.colors.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Icon name="card" size={18} color={t.colors.accentDeep} />
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 13, t.colors.ink)}>How fees work</RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>What TaskDrop takes, and when</RNText>
          </View>
          <RNText style={tx('600', 16, t.colors.muted)}>›</RNText>
        </Pressable>

        <RNText style={tx('800', 16, t.colors.ink, { marginTop: 26 })}>Your conversations</RNText>
        {tickets === null ? (
          <Shimmer height={64} style={{ marginTop: 12 }} />
        ) : tickets.length === 0 ? (
          <EmptyState icon="help" title="No conversations yet" body="Anything you send the support team shows up here." style={{ paddingVertical: 24 }} />
        ) : (
          <>
            {open.length ? <RNText style={tx('600', 12, t.colors.muted, { marginTop: 12 })}>In progress ({open.length})</RNText> : null}
            {open.map((x) => <TicketRow key={x.id} ticket={x} onPress={() => go('ticket', { ticketId: x.id })} />)}
            {done.length ? <RNText style={tx('600', 12, t.colors.muted, { marginTop: 16 })}>Resolved ({done.length})</RNText> : null}
            {done.map((x) => <TicketRow key={x.id} ticket={x} onPress={() => go('ticket', { ticketId: x.id })} />)}
          </>
        )}
      </ScrollView>
      <FeedbackSheet visible={feedback} onClose={() => setFeedback(false)} />
    </Screen>
  );
}

function TicketRow({ ticket, onPress }: { ticket: Ticket; onPress: () => void }) {
  const t = useTheme();
  const s = STATUS[ticket.status] ?? STATUS.waiting!;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        marginTop: 10,
        padding: 13,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.colors.line,
        backgroundColor: t.colors.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <RNText style={tx('600', 13, t.colors.ink, { flex: 1 })} numberOfLines={1}>{ticket.subject}</RNText>
        <Badge label={s.label} tone={s.tone} />
      </View>
      <RNText style={tx('400', 11, t.colors.muted, { marginTop: 5 })}>
        {TICKET_CATEGORIES.find((c) => c.key === ticket.category)?.label} · {timeAgo(ticket.updated_at)}
      </RNText>
    </Pressable>
  );
}

/** One support conversation. */
export function TicketScreen() {
  const t = useTheme();
  const { back, params } = useNav();
  const { flash } = useActions();
  const ticketId = typeof params.ticketId === 'string' ? params.ticketId : null;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[] | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    const r = await getTicket(ticketId);
    setTicket(r?.ticket ?? null);
    setMessages(r?.messages ?? []);
  }, [ticketId]);

  useEffect(() => {
    void load().catch(() => setMessages([]));
  }, [load]);

  const send = async () => {
    if (!ticketId || !reply.trim()) return;
    setBusy(true);
    try {
      await replyTicket(ticketId, reply);
      setReply('');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (!ticketId) return;
    try {
      await resolveTicket(ticketId);
      flash('Marked as resolved');
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update that');
    }
  };

  const s = STATUS[ticket?.status ?? 'waiting'] ?? STATUS.waiting!;

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <TopBar title="Your conversation" onBack={back} right={<Badge label={s.label} tone={s.tone} />} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
          {messages === null ? (
            <Shimmer height={80} />
          ) : (
            messages.map((m, i) => {
              const mine = !m.from_staff;
              return (
                <FadeIn key={m.id} duration={260} delay={Math.min(i, 6) * 30}>
                  <View
                    style={{
                      alignSelf: mine ? 'flex-end' : 'flex-start',
                      maxWidth: '85%',
                      marginTop: 10,
                      backgroundColor: mine ? t.colors.accentSoft : t.colors.surface,
                      borderWidth: 1,
                      borderColor: mine ? t.colors.accentBorder : t.colors.line,
                      borderRadius: 14,
                      padding: 12,
                    }}
                  >
                    <RNText style={tx('700', 11, mine ? t.colors.accentDeep : t.colors.purpleDeep)}>
                      {mine ? 'You' : 'TaskDrop support'}
                    </RNText>
                    <RNText style={tx('400', 14, t.colors.ink, { marginTop: 4, lineHeight: 20 })}>{m.body}</RNText>
                    <RNText style={tx('400', 10, t.colors.muted, { marginTop: 6 })}>{timeAgo(m.created_at)}</RNText>
                  </View>
                </FadeIn>
              );
            })
          )}
        </ScrollView>
        {ticket && ticket.status !== 'resolved' ? (
          <View style={{ paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.colors.line }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <TextInput
                value={reply}
                onChangeText={setReply}
                placeholder="Write a reply"
                placeholderTextColor={t.colors.muted}
                multiline
                style={tx('400', 14, t.colors.ink, {
                  flex: 1,
                  maxHeight: 110,
                  backgroundColor: t.colors.surface2,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                })}
              />
              <Pressable
                onPress={() => void send()}
                disabled={busy || !reply.trim()}
                accessibilityRole="button"
                accessibilityLabel="Send reply"
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  backgroundColor: reply.trim() ? t.colors.accent : t.colors.surface2,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="send" size={18} color={reply.trim() ? t.colors.onAccent : t.colors.muted} />
              </Pressable>
            </View>
            <Pressable onPress={() => void resolve()} style={{ alignSelf: 'center', marginTop: 10 }} accessibilityRole="button">
              <RNText style={tx('700', 13, t.colors.accentDeep)}>Mark as resolved</RNText>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}
