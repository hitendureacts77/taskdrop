import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, TextInput, KeyboardAvoidingView } from 'react-native';
import { Screen } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { KeyboardSafe } from '../components/KeyboardSafe';
import { Badge, Field, LoadFailed, Pill, PrimaryButton, Shimmer, TopBar, timeAgo } from '../components/kit';
import { bugReportsOn, showBugReport } from '../lib/monitoring';
import { lengthHint } from '../lib/fieldHint';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useLayout } from '../lib/layout';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { KeyboardScrollView } from '../components/KeyboardScrollView';
import { ActionBar, FormPage, FormSection } from '../components/FormPage';
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
  // Desktop: the composer is a form card (FormPage) with the help links beside it, the conversations in two columns under the send bar.
  const { desktop, columns } = useLayout();
  const { back, go } = useNav();
  const { flash, celebrate } = useActions();
  const [category, setCategory] = useState<TicketCategory>('payment');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setTickets(await listTickets());
    setFailed(false);
  }, []);
  const loadOrFail = useCallback(
    () =>
      load().catch(() => {
        setFailed(true);
        setTickets((prev) => prev ?? []);
      }),
    [load],
  );
  useEffect(() => {
    void loadOrFail();
  }, [loadOrFail]);

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

  const groupStyle = { borderRadius: 14, borderWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface, overflow: 'hidden' } as const;
  const sendButton = (
    <PrimaryButton label="Send message" onPress={() => void send()} busy={busy} disabled={body.trim().length < 5} style={{ marginTop: desktop ? 0 : 14 }} />
  );
  const composer = (
    <>
      {desktop ? null : <RNText accessibilityRole="header" style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>Get help</RNText>}
      <RNText style={tx('600', 12, t.colors.muted, { marginTop: desktop ? 0 : 14 })}>What is it about?</RNText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
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
        hint={lengthHint(body, 5, 'your message') ?? 'Include the task name or amount if it is about a payment.'}
      />
      {desktop ? null : sendButton}
    </>
  );
  const links = (
    <>
      <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginBottom: 8, marginTop: desktop ? 0 : 24 })}>MORE WAYS TO HELP</RNText>
      <View style={groupStyle}>
        <LinkRow icon="card" label="How fees work" sub="What TaskDrop takes, and when" onPress={() => go('pricing')} />
        <LinkRow icon="sparkle" label="How TaskDrop works" sub="A short animated tour" onPress={() => go('intro', { replay: true })} divider />
        <LinkRow icon="send" label="Ideas and feedback" sub="Suggest a feature, or vote" onPress={() => go('ideas')} divider />
        <LinkRow icon="dots" label="More" sub={more ? 'Legal pages and reports' : 'Legal pages, bugs, takedowns'} onPress={() => setMore((v) => !v)} divider expanded={more} />
        {more ? (
          <View style={{ backgroundColor: t.colors.surface2 }}>
            <LinkRow icon="flag" label="Copyright and takedowns" onPress={() => go('copyright')} />
            <LinkRow icon="lock" label="Security reports and contact" onPress={() => go('support')} divider />
            {bugReportsOn() ? <LinkRow icon="help" label="Report a bug" onPress={showBugReport} divider /> : null}
            <LinkRow icon="file" label="Terms of Service" onPress={() => go('terms')} divider />
            <LinkRow icon="shield" label="Privacy Policy" onPress={() => go('privacy')} divider />
          </View>
        ) : null}
      </View>
    </>
  );
  const convos = (
    <>
      {desktop ? null : <RNText style={tx('800', 16, t.colors.ink, { marginTop: 28 })}>Your conversations</RNText>}
      {tickets === null ? (
        <Shimmer height={64} style={{ marginTop: 12 }} />
      ) : tickets.length === 0 && failed ? (
        <LoadFailed title="Couldn’t load your conversations" onRetry={() => void loadOrFail()} style={{ paddingVertical: 24 }} />
      ) : tickets.length === 0 ? (
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 8 })}>Nothing yet. Your messages to the team show up here.</RNText>
      ) : (
        <>
          {open.length ? <RNText style={tx('600', 12, t.colors.muted, { marginTop: 12 })}>In progress ({open.length})</RNText> : null}
          <TicketList rows={open} cols={desktop ? Math.min(2, columns) : 1} onOpen={(id) => go('ticket', { ticketId: id })} />
          {done.length ? <RNText style={tx('600', 12, t.colors.muted, { marginTop: 16 })}>Resolved ({done.length})</RNText> : null}
          <TicketList rows={done} cols={desktop ? Math.min(2, columns) : 1} onOpen={(id) => go('ticket', { ticketId: id })} />
        </>
      )}
    </>
  );

  return (
    <Screen padded={false}>
      <TopBar title="Help & support" onBack={back} />
      <FormPage
        scrollProps={{ style: { flex: 1 }, contentContainerStyle: { paddingHorizontal: 20, paddingBottom: 28 }, keyboardShouldPersistTaps: 'handled' }}
        aside={links}
        actions={
          desktop ? (
            <>
              <ActionBar>{sendButton}</ActionBar>
              <FormSection title="Your conversations">{convos}</FormSection>
            </>
          ) : undefined
        }
      >
        {desktop ? (
          <FormSection first title="Get help">
            {composer}
          </FormSection>
        ) : (
          <>
            {composer}
            {links}
            {convos}
          </>
        )}
      </FormPage>
    </Screen>
  );
}

/** One row in the help list: icon, a short name, at most one line under it. */
function LinkRow({ icon, label, sub, onPress, divider, expanded }: { icon: IconName; label: string; sub?: string; onPress: () => void; divider?: boolean; expanded?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ pressed }) => ({
        paddingVertical: 13,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderTopWidth: divider ? 1 : 0,
        borderTopColor: t.colors.line,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon name={icon} size={18} color={t.colors.accentDeep} />
      <View style={{ flex: 1 }}>
        <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>{label}</RNText>
        {sub ? <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>{sub}</RNText> : null}
      </View>
      <View style={expanded ? { transform: [{ rotate: '90deg' }] } : undefined}>
        <Icon name="chevronRight" size={16} color={t.colors.muted} />
      </View>
    </Pressable>
  );
}

/** Support conversations in a column, or two or three side by side on a wide desktop. */
function TicketList({ rows, cols, onOpen }: { rows: Ticket[]; cols: number; onOpen: (id: string) => void }) {
  if (cols < 2) return <>{rows.map((x) => <TicketRow key={x.id} ticket={x} onPress={() => onOpen(x.id)} />)}</>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 }}>
      {rows.map((x) => (
        <View key={x.id} style={{ width: `${100 / cols}%`, paddingHorizontal: 5 }}>
          <TicketRow ticket={x} onPress={() => onOpen(x.id)} />
        </View>
      ))}
    </View>
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

  // No badge until the ticket has loaded, so it never flashes a status it doesn't have.
  const s = ticket ? (STATUS[ticket.status] ?? STATUS.waiting!) : null;

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <TopBar title="Your conversation" onBack={back} right={s ? <Badge label={s.label} tone={s.tone} /> : undefined} />
        <KeyboardScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
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
                    <RNText style={tx('700', 11, t.colors.accentDeep)}>
                      {mine ? 'You' : 'TaskDrop support'}
                    </RNText>
                    <RNText style={tx('400', 14, t.colors.ink, { marginTop: 4, lineHeight: 20 })}>{m.body}</RNText>
                    <RNText style={tx('400', 10, t.colors.muted, { marginTop: 6 })}>{timeAgo(m.created_at)}</RNText>
                  </View>
                </FadeIn>
              );
            })
          )}
        </KeyboardScrollView>
        {ticket && ticket.status !== 'resolved' ? (
          <KeyboardSafe style={{ paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.colors.line }}>
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
          </KeyboardSafe>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}
