import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput } from 'react-native';
import { Screen, cardSurface } from '../components/ui';
import { Badge, ConfirmDialog, PrimaryButton, Shimmer, TopBar } from '../components/kit';
import { Icon } from '../components/Icon';
import { HeroCard } from '../components/Hero';
import { DateTimeSheet } from '../components/DateTimeSheet';
import { KeyboardScrollView } from '../components/KeyboardScrollView';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useFocusTick, useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import { listMyTasks, type Task } from '../data/api';
import { GUEST_DRAFTS_OWNER } from '../lib/guest';
import { listBigDays, releaseBigDayItem, removeBigDay, saveBigDay } from '../lib/bigDayStore';
import {
  EVENTS,
  MAX_PLANS,
  TITLE_MAX,
  addDays,
  cleanTitle,
  dayKey,
  eventDef,
  kindLabel,
  longDay,
  newPlan,
  parseDay,
  postPrompt,
  stateFor,
  tickedCount,
  whenLabel,
  type BigDayItem,
  type BigDayPlan,
  type BigDayState,
  type EventKey,
} from '../lib/bigDays';
import { reportError } from '../lib/errors';

/** The plan opens two weeks out: far enough to be a real date, near enough to be a real plan. */
const DEFAULT_AHEAD_DAYS = 14;

const todayKey = () => dayKey(new Date());

/**
 * Plan a big day (D19, "TaskDrop Together"): pick the event and the date and get a whole plan, a list of
 * ordinary tasks placed around that day. Each line is ticked, edited and posted through the normal
 * writer, one at a time, and the person sets every price there. The saved plan lives on this device
 * (lib/bigDayStore.ts); its board shows each line's real task status.
 */
export function BigDayScreen() {
  const { params, back } = useNav();
  const { userId, guest } = useAuth();
  const owner = userId ?? (guest ? GUEST_DRAFTS_OWNER : null);
  const focusTick = useFocusTick();
  const [plans, setPlans] = useState<BigDayPlan[] | null>(null);
  // 'plan' = the planner; 'board' = the saved plan. Null until the saved plans are read.
  const [view, setView] = useState<'plan' | 'board' | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const wantsNew = params.new === true;

  useEffect(() => {
    if (!owner) {
      setPlans([]);
      setView((v) => v ?? 'plan');
      return;
    }
    let alive = true;
    void listBigDays(owner).then((rows) => {
      if (!alive) return;
      setPlans(rows);
      setView((v) => v ?? (rows.length > 0 && !wantsNew ? 'board' : 'plan'));
      setCurrent((c) => (c && rows.some((p) => p.id === c) ? c : (rows[0]?.id ?? null)));
    });
    return () => {
      alive = false;
    };
  }, [owner, focusTick, wantsNew]);

  if (plans === null || view === null) {
    return (
      <Screen padded={false}>
        <TopBar title="Plan a big day" onBack={back} />
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <Shimmer height={190} />
          <Shimmer height={260} />
        </View>
      </Screen>
    );
  }

  if (view === 'board' && plans.length > 0) {
    return (
      <Board
        owner={owner}
        plans={plans}
        setPlans={setPlans}
        currentId={current ?? plans[0]!.id}
        setCurrent={setCurrent}
        onPlanAnother={() => setView('plan')}
        onEmpty={() => setView('plan')}
      />
    );
  }

  return (
    <Planner
      owner={owner}
      plans={plans}
      onSaved={(rows, id) => {
        setPlans(rows);
        setCurrent(id);
        setView('board');
      }}
    />
  );
}

// -------------------------------------------------------------- planner ---

function Planner({
  owner,
  plans,
  onSaved,
}: {
  owner: string | null;
  plans: BigDayPlan[];
  onSaved: (plans: BigDayPlan[], id: string) => void;
}) {
  const t = useTheme();
  const { back } = useNav();
  const { flash } = useActions();
  const [draft, setDraft] = useState<BigDayPlan>(() => newPlan('draft', 'moving', addDays(todayKey(), DEFAULT_AHEAD_DAYS)));
  const [pickDate, setPickDate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const def = eventDef(draft.event);
  const today = todayKey();
  const ticked = tickedCount(draft);

  const setEvent = (event: EventKey) => {
    if (event === draft.event) return;
    // A different event is a different list: the edits to the old one go with it.
    setDraft(newPlan('draft', event, draft.day));
    setEditing(null);
  };
  const patch = (id: string, change: Partial<BigDayItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...change } : i)) }));

  // The picker wants a moment in time: nine in the morning of the chosen day, or an hour from now if that has passed.
  const pickerStart = useMemo(() => {
    const d = parseDay(draft.day) ?? new Date();
    d.setHours(9, 0, 0, 0);
    return d.getTime() > Date.now() ? d : new Date(Date.now() + 3600_000);
  }, [draft.day]);

  const save = async () => {
    if (saving || !owner || ticked === 0) return;
    setSaving(true);
    try {
      const id = `p${Date.now().toString(36)}`;
      const plan: BigDayPlan = { ...draft, id, createdAt: Date.now() };
      const rows = await saveBigDay(owner, plan);
      onSaved(rows, id);
    } catch (e) {
      reportError(e, 'bigDay.save');
      flash('Could not save your plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen padded={false}>
      <TopBar title="Plan a big day" onBack={back} />
      <KeyboardScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <FadeIn>
          <HeroCard style={{ marginHorizontal: 20, marginTop: 4 }} radius={22} padding={18}>
            <RNText style={tx('700', 11, 'rgba(255,255,255,0.85)', { letterSpacing: 1.3 })}>ONE DATE IN, A WHOLE PLAN OUT</RNText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 6 }}>
              {EVENTS.map((e) => {
                const on = e.key === draft.event;
                return (
                  <Pressy
                    key={e.key}
                    onPress={() => setEvent(e.key)}
                    scaleTo={0.97}
                    label={e.label}
                    style={{
                      height: 32,
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      justifyContent: 'center',
                      backgroundColor: on ? '#FFFFFF' : 'rgba(255,255,255,0.16)',
                    }}
                  >
                    <RNText style={tx('700', 12.5, on ? t.colors.heroTo : '#FFFFFF')}>{e.label}</RNText>
                  </Pressy>
                );
              })}
            </ScrollView>
            <Pressable
              onPress={() => setPickDate(true)}
              accessibilityRole="button"
              accessibilityLabel={`${def.dayLabel}: ${longDay(draft.day)}. Change`}
              style={{
                marginTop: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: 'rgba(10,12,14,0.55)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.2)',
                borderRadius: 16,
                paddingVertical: 12,
                paddingHorizontal: 14,
              }}
            >
              <Icon name="calendar" size={18} color="#FFFFFF" />
              <View style={{ flex: 1 }}>
                <RNText style={tx('400', 12, 'rgba(255,255,255,0.75)')}>{def.dayLabel}</RNText>
                <RNText style={tx('800', 16, '#FFFFFF')}>{longDay(draft.day)}</RNText>
              </View>
              <RNText style={tx('700', 12.5, 'rgba(255,255,255,0.85)')}>Change</RNText>
            </Pressable>
          </HeroCard>
        </FadeIn>

        <View style={{ paddingHorizontal: 20, paddingTop: 20, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="sparkle" size={16} color={t.colors.ai} />
          <RNText style={tx('800', 18, t.colors.ink, { flex: 1, letterSpacing: -0.3 })}>Your plan</RNText>
          <RNText style={tx('700', 12.5, t.colors.muted)}>
            {ticked} of {draft.items.length} ticked
          </RNText>
        </View>

        <View style={[cardSurface(t, 18), { marginHorizontal: 20, marginTop: 8, paddingHorizontal: 14, paddingVertical: 2 }]}>
          {draft.items.map((item, i) => (
            <PlanRow
              key={`${draft.event}-${item.id}`}
              item={item}
              when={whenLabel(draft.day, item, today)}
              last={i === draft.items.length - 1}
              editing={editing === item.id}
              onToggle={() => patch(item.id, { on: !item.on })}
              onEdit={() => setEditing(item.id)}
              onDone={(title) => {
                setEditing(null);
                const clean = cleanTitle(title);
                if (clean) patch(item.id, { title: clean });
              }}
            />
          ))}
        </View>
        <RNText style={tx('400', 12.5, t.colors.muted, { marginHorizontal: 20, marginTop: 10, lineHeight: 18 })}>
          Tap any line to change it. Each becomes a normal task; you set each price.
        </RNText>
        {plans.length >= MAX_PLANS ? (
          <RNText style={tx('400', 12.5, t.colors.muted, { marginHorizontal: 20, marginTop: 6, lineHeight: 18 })}>
            You already keep {MAX_PLANS} plans. Saving this one replaces the oldest.
          </RNText>
        ) : null}
      </KeyboardScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 }}>
        <PrimaryButton
          label={ticked > 0 ? `Save my plan (${ticked})` : 'Tick at least one task'}
          onPress={() => void save()}
          busy={saving}
          disabled={ticked === 0 || !owner}
        />
      </View>

      <DateTimeSheet
        visible={pickDate}
        quick={false}
        initial={pickerStart}
        onCancel={() => setPickDate(false)}
        onConfirm={(d) => {
          // Only the day matters here. The sheet already refuses a moment in the past.
          const key = dayKey(d);
          setDraft((p) => ({ ...p, day: key < todayKey() ? todayKey() : key }));
          setPickDate(false);
        }}
      />
    </Screen>
  );
}

function PlanRow({
  item,
  when,
  last,
  editing,
  onToggle,
  onEdit,
  onDone,
}: {
  item: BigDayItem;
  when: string;
  last: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDone: (title: string) => void;
}) {
  const t = useTheme();
  const [text, setText] = useState(item.title);
  useEffect(() => {
    if (editing) setText(item.title);
  }, [editing, item.title]);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: t.colors.line,
      }}
    >
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.on }}
        accessibilityLabel={item.title}
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: item.on ? t.colors.btn : 'transparent',
          borderWidth: item.on ? 0 : 2,
          borderColor: t.colors.line,
        }}
      >
        {item.on ? <Icon name="check" size={13} color={t.colors.onBtn} strokeWidth={3.2} /> : null}
      </Pressable>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit: ${item.title}`}
        style={{ flex: 1, minWidth: 0 }}
      >
        {editing ? (
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            maxLength={TITLE_MAX}
            returnKeyType="done"
            onSubmitEditing={() => onDone(text)}
            onBlur={() => onDone(text)}
            accessibilityLabel="Task title"
            style={tx('700', 14, t.colors.ink, { padding: 0, margin: 0 })}
            placeholderTextColor={t.colors.muted}
          />
        ) : (
          <RNText style={tx('700', 14, item.on ? t.colors.ink : t.colors.muted)}>{item.title}</RNText>
        )}
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
          {when} ·{' '}
          <RNText style={item.kind === 'online' ? tx('700', 12, t.colors.aiInk) : undefined}>{kindLabel(item.kind)}</RNText>
        </RNText>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------- board ---

const STATE_BADGE: Record<Exclude<BigDayState, 'not_posted'>, { label: string; tone: 'accent' | 'gold' | 'blue' | 'neutral' }> = {
  posted: { label: 'Posted', tone: 'accent' },
  hired: { label: 'Hired', tone: 'gold' },
  done: { label: 'Done', tone: 'blue' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

function Board({
  owner,
  plans,
  setPlans,
  currentId,
  setCurrent,
  onPlanAnother,
  onEmpty,
}: {
  owner: string | null;
  plans: BigDayPlan[];
  setPlans: (p: BigDayPlan[]) => void;
  currentId: string;
  setCurrent: (id: string) => void;
  onPlanAnother: () => void;
  onEmpty: () => void;
}) {
  const t = useTheme();
  const { back, go } = useNav();
  const { flash } = useActions();
  const { userId } = useAuth();
  const focusTick = useFocusTick();
  const plan = plans.find((p) => p.id === currentId) ?? plans[0]!;
  const def = eventDef(plan.event);
  const today = todayKey();
  const items = plan.items.filter((i) => i.on);

  // The real tasks behind the posted lines, from the same read My Tasks uses for the poster's own tasks.
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
  const anyPosted = items.some((i) => i.taskId);
  const load = useCallback(async () => {
    if (!userId || !anyPosted) return;
    const rows = await listMyTasks(userId);
    setTasks(new Map(rows.map((r) => [r.id, r])));
  }, [userId, anyPosted, focusTick]);
  useEffect(() => {
    void load().catch((e) => reportError(e, 'bigDay.status'));
  }, [load]);

  const [confirmDelete, setConfirmDelete] = useState(false);

  const post = async (item: BigDayItem, state: BigDayState) => {
    // A cancelled task lets go of its line, so the new post can take its place.
    if (state === 'cancelled' && owner) await releaseBigDayItem(owner, plan.id, item.id);
    go('aiPost', { prompt: postPrompt(plan, item, today), bigDay: { planId: plan.id, itemId: item.id } });
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (!owner) return;
    const rows = await removeBigDay(owner, plan.id);
    setPlans(rows);
    flash('Plan deleted');
    if (rows.length === 0) onEmpty();
    else setCurrent(rows[0]!.id);
  };

  const posted = items.filter((i) => i.taskId && stateFor(i.taskId, tasks.get(i.taskId)?.status) !== 'cancelled').length;

  return (
    <Screen padded={false}>
      <TopBar title="Your big day" onBack={back} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {plans.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingBottom: 12 }}>
            {plans.map((p) => {
              const on = p.id === plan.id;
              return (
                <Pressy
                  key={p.id}
                  onPress={() => setCurrent(p.id)}
                  scaleTo={0.97}
                  label={`${eventDef(p.event).label}, ${longDay(p.day)}`}
                  style={{
                    height: 34,
                    borderRadius: 999,
                    paddingHorizontal: 14,
                    justifyContent: 'center',
                    backgroundColor: on ? t.colors.btn : t.colors.surface,
                    borderWidth: 1,
                    borderColor: on ? t.colors.btn : t.colors.line,
                  }}
                >
                  <RNText style={tx('700', 12.5, on ? t.colors.onBtn : t.colors.ink)}>
                    {eventDef(p.event).label} · {longDay(p.day)}
                  </RNText>
                </Pressy>
              );
            })}
          </ScrollView>
        ) : null}

        <FadeIn>
          <HeroCard style={{ marginHorizontal: 20 }} radius={22} padding={18}>
            <RNText style={tx('700', 11, 'rgba(255,255,255,0.85)', { letterSpacing: 1.3 })}>{def.label.toUpperCase()}</RNText>
            <RNText style={tx('800', 26, '#FFFFFF', { marginTop: 6, letterSpacing: -0.6 })}>{longDay(plan.day)}</RNText>
            <RNText style={tx('600', 13, 'rgba(255,255,255,0.85)', { marginTop: 4 })}>
              {def.dayLabel} · {posted} of {items.length} posted
            </RNText>
          </HeroCard>
        </FadeIn>

        <View style={{ paddingHorizontal: 20, paddingTop: 20, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="sparkle" size={16} color={t.colors.ai} />
          <RNText style={tx('800', 18, t.colors.ink, { flex: 1, letterSpacing: -0.3 })}>Your plan</RNText>
        </View>
        <View style={[cardSurface(t, 18), { marginHorizontal: 20, marginTop: 8, paddingHorizontal: 14, paddingVertical: 2 }]}>
          {items.map((item, i) => {
            const task = item.taskId ? tasks.get(item.taskId) : undefined;
            const state = stateFor(item.taskId, task?.status);
            return (
              <View
                key={item.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  borderBottomWidth: i === items.length - 1 ? 0 : 1,
                  borderBottomColor: t.colors.line,
                }}
              >
                <Pressable
                  disabled={!item.taskId || state === 'cancelled'}
                  onPress={() => item.taskId && go('taskManage', { taskId: item.taskId })}
                  accessibilityRole={item.taskId ? 'button' : undefined}
                  accessibilityLabel={item.taskId ? `Open task: ${item.title}` : undefined}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <RNText style={tx('700', 14, t.colors.ink)}>{item.title}</RNText>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                    {whenLabel(plan.day, item, today)} ·{' '}
                    <RNText style={item.kind === 'online' ? tx('700', 12, t.colors.aiInk) : undefined}>{kindLabel(item.kind)}</RNText>
                  </RNText>
                </Pressable>
                {state === 'not_posted' || state === 'cancelled' ? (
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    {state === 'cancelled' ? <Badge label={STATE_BADGE.cancelled.label} tone="neutral" /> : null}
                    <Pressy
                      onPress={() => void post(item, state)}
                      scaleTo={0.96}
                      label={`Post: ${item.title}`}
                      style={{ height: 34, borderRadius: 999, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: t.colors.btn }}
                    >
                      <RNText style={tx('800', 13, t.colors.onBtn)}>Post</RNText>
                    </Pressy>
                  </View>
                ) : (
                  <Badge label={STATE_BADGE[state].label} tone={STATE_BADGE[state].tone} />
                )}
              </View>
            );
          })}
        </View>
        {items.some((i) => !i.taskId) ? (
          <RNText style={tx('400', 12.5, t.colors.muted, { marginHorizontal: 20, marginTop: 10, lineHeight: 18 })}>
            Post opens the writer with the task filled in. You set the price there.
          </RNText>
        ) : null}

        <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 10 }}>
          <PrimaryButton
            label="Plan another day"
            tone="quiet"
            onPress={() => (plans.length >= MAX_PLANS ? flash(`You can keep ${MAX_PLANS} plans. Delete one first.`) : onPlanAnother())}
          />
          <Pressable
            onPress={() => setConfirmDelete(true)}
            accessibilityRole="button"
            style={{ alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 }}
          >
            <RNText style={tx('700', 13, t.colors.signalDeep)}>Delete this plan</RNText>
          </Pressable>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmDelete}
        title="Delete this plan?"
        message="The plan goes from this device. Tasks you already posted stay in My Tasks."
        confirmLabel="Delete plan"
        danger
        icon="close"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}
