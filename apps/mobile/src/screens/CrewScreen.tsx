import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { Avatar, Screen, cardSurface } from '../components/ui';
import { Badge, EmptyState, Field, LoadFailed, PrimaryButton, Shimmer, TopBar, rupees, timeAgo } from '../components/kit';
import { Icon } from '../components/Icon';
import { FadeIn, tx } from '../components/primitives';
import { KeyboardScrollView } from '../components/KeyboardScrollView';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { crewOverview, listCrewMessages, sendCrewMessage, type CrewMessage, type CrewSlot } from '../data/api';
import { reportError } from '../lib/errors';

/** How often the crew chat looks for new messages while it is open. */
const REFRESH_MS = 15_000;

/**
 * A crew job (migration 134): one task for several helpers, each slot hired
 * and paid on its own. The slots, who has joined, and the chat the poster and
 * the people hired share. Names and the chat are only for the crew itself.
 */
export function CrewScreen() {
  const t = useTheme();
  const { params, back, go } = useNav();
  const { flash } = useActions();
  const { userId } = useAuth();
  const crewId = typeof params.crewId === 'string' ? params.crewId : null;
  const [slots, setSlots] = useState<CrewSlot[] | null>(null);
  const [messages, setMessages] = useState<CrewMessage[]>([]);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!crewId) return setSlots([]);
    const [s, m] = await Promise.all([crewOverview(crewId), listCrewMessages(crewId)]);
    setSlots(s);
    setMessages(m);
    setFailed(false);
  }, [crewId]);

  useEffect(() => {
    void load().catch((e) => {
      reportError(e, 'crew');
      setFailed(true);
    });
    const id = setInterval(() => void load().catch(() => {}), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (failed && slots === null) {
    return (
      <Screen padded={false}>
        <TopBar title="Crew" onBack={back} />
        <LoadFailed title="Couldn’t load this crew" onRetry={() => void load().catch(() => setFailed(true))} />
      </Screen>
    );
  }
  if (slots === null) {
    return (
      <Screen padded={false}>
        <TopBar title="Crew" onBack={back} />
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <Shimmer height={140} />
          <Shimmer height={220} />
        </View>
      </Screen>
    );
  }
  if (slots.length === 0) {
    return (
      <Screen padded={false}>
        <TopBar title="Crew" onBack={back} />
        <EmptyState icon="users" title="This crew could not be found" body="It may have been closed." />
      </Screen>
    );
  }

  const size = slots[0]?.size ?? slots.length;
  const filled = slots.filter((s) => s.worker_id).length;
  const totalMinor = slots.reduce((sum, s) => sum + s.price_minor, 0);
  // The poster and the people hired open this from their own task (member: true); names only reach members too.
  const member = params.member === true || slots.some((s) => s.worker_name !== null);
  const nameOf = (sender: string) =>
    sender === userId ? 'You' : (slots.find((s) => s.worker_id === sender)?.worker_name ?? 'Customer');

  const send = async () => {
    const body = draft.trim();
    if (!crewId || !body || sending) return;
    setSending(true);
    try {
      const m = await sendCrewMessage(crewId, body);
      setMessages((cur) => [...cur, m]);
      setDraft('');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen padded={false}>
      <TopBar title="Crew" subtitle={slots[0]?.title} onBack={back} />
      <KeyboardScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        <View style={{ borderRadius: 22, padding: 18, backgroundColor: t.colors.hero }}>
          <RNText style={tx('700', 11, '#FFFFFF', { letterSpacing: 1.2, opacity: 0.85 })}>EACH HELPER GETS</RNText>
          <RNText style={tx('800', 30, '#FFFFFF', { letterSpacing: -0.8, marginTop: 2, fontVariant: ['tabular-nums'] })}>
            {rupees((slots[0]?.price_minor ?? 0) / 100)}
          </RNText>
          <RNText style={tx('500', 12, '#FFFFFF', { opacity: 0.9, marginTop: 4 })}>
            {rupees(totalMinor / 100)} in all · each slot is held safely on its own
          </RNText>
        </View>

        <View style={{ ...cardSurface(t, 18), padding: 16, marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <RNText style={tx('800', 15, t.colors.ink, { flex: 1 })}>
              Crew · {filled} of {size} joined
            </RNText>
            {filled < size ? <Badge label={`${size - filled} open`} tone="accent" /> : <Badge label="Full" tone="gold" />}
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
            {slots.map((s) => (
              <View key={s.task_id} style={{ flex: 1, height: 6, borderRadius: 6, backgroundColor: s.worker_id ? t.colors.accent : t.colors.line }} />
            ))}
          </View>
          {slots.map((s, i) => (
            <FadeIn key={s.task_id} translateY={8} delay={i * 50}>
              <Pressable
                onPress={() => go('taskManage', { taskId: s.task_id, title: s.title })}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}
              >
                {s.worker_id ? (
                  <Avatar name={s.worker_name ?? 'Helper'} size={42} />
                ) : (
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 42,
                      borderWidth: 2,
                      borderStyle: 'dashed',
                      borderColor: t.colors.accentBorder,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="plus" size={16} color={t.colors.accent} strokeWidth={2.4} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 14, s.worker_id ? t.colors.ink : t.colors.muted)}>
                    {s.worker_id ? (s.worker_name ?? 'A helper') : 'Waiting for a helper'}
                  </RNText>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                    Helper {s.slot} of {s.size} · {rupees(s.price_minor / 100)}
                  </RNText>
                </View>
                <Icon name="chevronRight" size={16} color={t.colors.muted} />
              </Pressable>
            </FadeIn>
          ))}
        </View>

        <View style={{ ...cardSurface(t, 18), padding: 16, marginTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="chat" size={16} color={t.colors.accentDeep} />
            <RNText style={tx('800', 15, t.colors.ink)}>Crew chat</RNText>
          </View>
          {!member ? (
            <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10, lineHeight: 19 })}>
              The chat opens to you once you are hired for one of the slots.
            </RNText>
          ) : (
            <>
              {messages.length === 0 ? (
                <RNText style={tx('400', 13, t.colors.muted, { marginTop: 10, lineHeight: 19 })}>
                  Plan the day together: when to meet, who brings what. Contact details are shared in each helper’s own
                  chat once their work starts.
                </RNText>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_id === userId;
                  return (
                    <View key={m.id} style={{ marginTop: 10, alignItems: mine ? 'flex-end' : 'flex-start' }}>
                      <View
                        style={{
                          maxWidth: '85%',
                          borderRadius: 16,
                          paddingVertical: 9,
                          paddingHorizontal: 12,
                          backgroundColor: mine ? t.colors.accentSoft : t.colors.surface2,
                        }}
                      >
                        {mine ? null : <RNText style={tx('700', 11, t.colors.accentDeep, { marginBottom: 2 })}>{nameOf(m.sender_id)}</RNText>}
                        <RNText style={tx('400', 14, t.colors.ink, { lineHeight: 20 })}>{m.body}</RNText>
                      </View>
                      <RNText style={tx('400', 10.5, t.colors.muted, { marginTop: 3 })}>{timeAgo(m.created_at)}</RNText>
                    </View>
                  );
                })
              )}
              <Field
                label="Message the crew"
                value={draft}
                onChangeText={setDraft}
                maxLength={2000}
                style={{ marginTop: 14 }}
                onSubmitEditing={() => void send()}
                returnKeyType="send"
              />
              <PrimaryButton label="Send" onPress={() => void send()} busy={sending} disabled={!draft.trim()} style={{ marginTop: 10 }} />
            </>
          )}
        </View>
      </KeyboardScrollView>
    </Screen>
  );
}
