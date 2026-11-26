import { Children, isValidElement, useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, TextInput, Platform } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useFocusTick, useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { huntLook, listMyAssignments, listMyBids, type Task, type TaskWithPoster } from '../data/api';
import { workerAssignmentRow, workerBidRow, openRow, type ViewRow } from '../lib/taskRows';
import { huntPhase, isHunt } from '../lib/hunt';
import { roughPlace } from '../lib/place';
import { useLayout } from '../lib/layout';
import { Icon, type IconName } from './Icon';
import { rupees } from './kit';
import { categoryLabel } from './WorkCard';
import { Pressy, tx } from './primitives';
import { cardSurface } from './ui';
import { NewBadge } from './HomeLive';

/**
 * Home on a desktop browser (D31 web boards WebHire / WebEarn): the pieces that only the wide page has -- the
 * main column beside a ~300 px right rail, the search bar in the page header, the published-tasks table, the
 * "Jobs near" list and the rail cards. Every number and row comes from what Home already loads; phones and
 * tablets never draw these.
 */

/** The rail's width on the boards. */
const RAIL = 300;

/** The main column needs this much beside the rail; a narrower desktop window puts the rail under it. At 1440 x 900
 * the page zoom (lib/layout desktopScaleFor) leaves the main column about 614 px, and the boards keep the rail beside it. */
const MAIN_MIN = 560;

/** The main column and the right rail, side by side (or the rail below, on a narrow desktop window). */
export function DesktopColumns({ main, rail }: { main: React.ReactNode; rail: React.ReactNode }) {
  const { contentWidth } = useLayout();
  // The column less its own 20 px inset each side, the gap and the rail.
  if (contentWidth('feed') - 40 - 28 - RAIL < MAIN_MIN) {
    return (
      <View>
        {main}
        <View style={{ marginTop: 28, gap: 20 }}>{rail}</View>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 28 }}>
      <View style={{ flex: 1, minWidth: 0 }}>{main}</View>
      <View style={{ width: RAIL, gap: 20 }}>{rail}</View>
    </View>
  );
}

/**
 * Cards in equal columns at least `min` wide, measured from the column they sit in (the main column is narrower
 * than the page, so the page-wide `Grid` would fit one card too many). Never more columns than cards.
 */
export function MeasuredGrid({ min, children, gap = 14 }: { min: number; children: React.ReactNode; gap?: number }) {
  const [w, setW] = useState(0);
  const items = Children.toArray(children);
  const fit = w > 0 ? Math.max(1, Math.floor((w + gap) / (min + gap))) : 1;
  const cols = Math.max(1, Math.min(fit, 4, items.length));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {w > 0
        ? items.map((child, i) => (
            <View key={isValidElement(child) && child.key != null ? child.key : i} style={{ width: `${100 / cols}%`, paddingHorizontal: gap / 2 }}>
              {child}
            </View>
          ))
        : null}
    </View>
  );
}

/** A card in the right rail: a header line, then rows split by hairlines, then an optional link. */
export function RailCard({
  title,
  icon,
  dot,
  children,
  link,
  onLink,
}: {
  title: string;
  icon?: IconName;
  /** A green "live" dot in front of the title instead of an icon. */
  dot?: boolean;
  children: React.ReactNode;
  link?: string;
  onLink?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[cardSurface(t, 16), { overflow: 'hidden' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.colors.line }}>
        {dot ? <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: t.colors.online }} /> : null}
        {icon ? <Icon name={icon} size={15} color={t.colors.accentDeep} strokeWidth={2} /> : null}
        <RNText accessibilityRole="header" style={tx('800', 14.5, dot ? t.colors.accentDeep : t.colors.ink, { flex: 1 })} numberOfLines={1}>
          {title}
        </RNText>
      </View>
      {children}
      {link && onLink ? (
        <Pressable onPress={onLink} accessibilityRole="button" style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{link} ›</RNText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One row of a rail card: a bold line and a muted line under it, or a value on the right. */
export function RailRow({
  title,
  sub,
  value,
  first,
  onPress,
}: {
  title: string;
  sub?: string;
  value?: string;
  first?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, sub, value].filter(Boolean).join('. ')}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.colors.line,
        backgroundColor: hovered ? t.colors.surface2 : 'transparent',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={tx('700', 13.5, t.colors.ink, { lineHeight: 18 })} numberOfLines={2}>
          {title}
        </RNText>
        {sub ? (
          <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
            {sub}
          </RNText>
        ) : null}
      </View>
      {value ? <RNText style={tx('500', 13, t.colors.muted, { fontVariant: ['tabular-nums'] })}>{value}</RNText> : null}
    </Pressable>
  );
}

/**
 * The search bar in the page header's middle slot. Enter hands the words to the screen's own search flow
 * (Hire: Home's search results, the same as the Search screen; Earn: the Find work list).
 */
export function HeaderSearch({
  placeholder,
  label,
  initial = '',
  onSubmit,
}: {
  placeholder: string;
  label: string;
  initial?: string;
  onSubmit: (q: string) => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState(initial);
  const [focused, setFocused] = useState(false);
  useEffect(() => setQ(initial), [initial]);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        height: 42,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: focused ? t.colors.accent : t.colors.line,
        backgroundColor: t.colors.surface,
        paddingHorizontal: 14,
      }}
    >
      <Icon name="search" size={16} color={t.colors.muted} />
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder={placeholder}
        placeholderTextColor={t.colors.muted}
        onSubmitEditing={() => onSubmit(q.trim())}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        returnKeyType="search"
        accessibilityRole="search"
        accessibilityLabel={label}
        style={tx('400', 14, t.colors.ink, {
          flex: 1,
          minWidth: 0,
          height: 40,
          padding: 0,
          ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
        })}
      />
    </View>
  );
}

/** The small "Idea" tag: these are ideas to post, not services TaskDrop sells. */
export function IdeaTag({ plural = false }: { plural?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        backgroundColor: t.colors.surface2,
        borderWidth: 1,
        borderColor: t.colors.line,
      }}
    >
      <Icon name="sparkle" size={10} color={t.colors.muted} strokeWidth={2} />
      <RNText style={tx('700', 10.5, t.colors.muted)}>{plural ? 'Ideas' : 'Idea'}</RNText>
    </View>
  );
}

// ------------------------------------------------------------ hire ----------

/**
 * A task's one next step. Colour by whose move it is (task 1.19, decision 6): `accent` is yours (the mode's colour,
 * a filled button), `muted` is waiting on the other person, `signal` is a problem. Gold stays for verified only.
 */
export type PublishedStep = { line: string; button: string; tone: 'accent' | 'muted' | 'signal' };

/**
 * "Needs you now" as a short table on the desktop Home (WebHire, task 1.19 F): task, status, offers (with the
 * "N new" pop), budget, the one next step; the link opens all of them in My tasks.
 */
export function PublishedTable({
  rows,
  onOpen,
  onManage,
  total,
}: {
  rows: { task: Task; step: PublishedStep; offers: number; fresh?: number }[];
  onOpen: (task: Task) => void;
  onManage: () => void;
  /** Every live task, for "All N in My tasks". */
  total: number;
}) {
  const t = useTheme();
  const head = (label: string, flex: number) => (
    <RNText style={tx('700', 11, t.colors.muted, { flex, letterSpacing: 0.9 })}>{label}</RNText>
  );
  return (
    <View testID="home-needs-table" style={[cardSurface(t, 16), { marginTop: 24, overflow: 'hidden' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 16 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.accent }} />
        <RNText accessibilityRole="header" style={tx('800', 17, t.colors.ink, { flex: 1, letterSpacing: -0.3 })}>
          Needs you now
        </RNText>
        <Pressable onPress={onManage} accessibilityRole="button" hitSlop={8}>
          <RNText style={tx('700', 13, t.colors.accentDeep)}>{`All ${total} in My tasks ›`}</RNText>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.colors.line, backgroundColor: t.colors.surface2 }}>
        {head('TASK', 2.6)}
        {head('STATUS', 1.2)}
        {head('OFFERS', 1)}
        {head('BUDGET', 0.8)}
        <View style={{ width: 150 }} />
      </View>
      {rows.map(({ task, step, offers, fresh = 0 }, i) => {
        const ink = step.tone === 'accent' ? t.colors.accentDeep : step.tone === 'signal' ? t.colors.signalDeep : t.colors.muted;
        const strong = step.tone === 'accent';
        const where = task.loc_lat === null ? 'Remote' : (roughPlace(task.loc_label) ?? '');
        const sub = [where, task.category].filter(Boolean).join(' · ');
        return (
          <Pressable
            key={task.id}
            onPress={() => onOpen(task)}
            accessibilityRole="button"
            accessibilityLabel={`${task.title}. ${step.line}. ${step.button}`}
            style={({ hovered }: { pressed: boolean; hovered?: boolean }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 20,
              paddingVertical: 14,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: t.colors.line,
              backgroundColor: hovered ? t.colors.surface2 : 'transparent',
            })}
          >
            <View style={{ flex: 2.6, minWidth: 0 }}>
              <RNText style={tx('700', 14, t.colors.ink, { lineHeight: 19 })} numberOfLines={2}>
                {task.title}
              </RNText>
              {sub ? (
                <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                  {sub}
                </RNText>
              ) : null}
            </View>
            <RNText style={tx('700', 12.5, ink, { flex: 1.2 })} numberOfLines={2}>
              {step.line}
            </RNText>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <RNText style={tx(offers > 0 ? '700' : '500', 13, offers > 0 ? t.colors.accentDeep : t.colors.muted)}>
                {task.status !== 'OPEN' ? '–' : offers > 0 ? `${offers} offer${offers === 1 ? '' : 's'}` : 'No offers'}
              </RNText>
              {task.status === 'OPEN' && fresh > 0 ? <NewBadge count={fresh} /> : null}
            </View>
            <RNText style={tx('800', 14, t.colors.ink, { flex: 0.8, fontVariant: ['tabular-nums'] })}>
              {rupees(task.benchmark_minor / 100)}
            </RNText>
            <View
              style={{
                width: 150,
                height: 34,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: strong ? t.colors.btn : t.colors.surface,
                borderWidth: strong ? 0 : 1,
                borderColor: t.colors.accentBorder,
              }}
            >
              <RNText style={tx('800', 13, strong ? t.colors.onBtn : t.colors.accentDeep)}>{step.button}</RNText>
            </View>
          </Pressable>
        );
      })}
      {/* Chat is locked until the poster hires someone (rule 3); questions go on the task meanwhile. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}>
        <Icon name="lock" size={13} color={t.colors.muted} />
        <RNText style={tx('500', 12, t.colors.muted, { flex: 1 })}>
          Chat opens after you hire. Before that, helpers send offers and you can answer questions on the task.
        </RNText>
      </View>
    </View>
  );
}

// ------------------------------------------------------------ earn ----------

/** One job in the "Jobs near" list card (WebEarn): what, who, how far, the price and Apply. */
export function JobRow({
  task,
  km,
  quoted,
  first,
  onOpen,
  onApply,
}: {
  task: TaskWithPoster;
  km: number;
  quoted: boolean;
  first: boolean;
  onOpen: () => void;
  onApply: () => void;
}) {
  const t = useTheme();
  // City Hunt: the same buttons as its card (WorkCard): I'm looking while it is live, otherwise open it.
  const hunt = isHunt(task);
  const huntOpen = hunt && huntPhase(task) === 'live';
  const [looking, setLooking] = useState(false);
  const lookThenOpen = async () => {
    if (looking) return;
    setLooking(true);
    try {
      await huntLook(task.id);
    } catch {
      /* the task page says why, and still lets them send a find */
    } finally {
      setLooking(false);
      onOpen();
    }
  };
  const rating =
    task.poster && task.poster.poster_rating_count > 0 ? Number(task.poster.poster_rating_avg).toFixed(1) : null;
  const who = task.poster?.username ? '@' + task.poster.username : (task.poster?.display_name ?? '');
  const meta = [categoryLabel(task), roughPlace(task.loc_label) ?? '', who, rating ? '★ ' + rating : ''].filter(Boolean).join(' · ');
  const button = huntOpen ? 'I’m looking' : hunt ? 'See it' : quoted ? 'Edit offer' : 'Apply';
  return (
    <Pressy
      containsControls
      onPress={onOpen}
      scaleTo={0.995}
      label={task.title}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 13, borderTopWidth: first ? 0 : 1, borderTopColor: t.colors.line }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={tx('700', 14.5, t.colors.ink, { lineHeight: 19 })} numberOfLines={1}>
          {task.title}
        </RNText>
        <RNText style={tx('500', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
          {meta}
        </RNText>
      </View>
      <RNText style={tx('500', 12.5, t.colors.muted, { width: 64, textAlign: 'right', fontVariant: ['tabular-nums'] })}>
        {km < 1 ? '< 1 km' : `${km.toFixed(km < 10 ? 1 : 0)} km`}
      </RNText>
      <RNText style={tx('800', 15.5, t.colors.accentDeep, { width: 84, textAlign: 'right', fontVariant: ['tabular-nums'] })}>
        {rupees(task.benchmark_minor / 100)}
      </RNText>
      <Pressy
        onPress={huntOpen ? () => void lookThenOpen() : hunt ? onOpen : onApply}
        label={huntOpen ? `I’m looking for ${task.title}` : hunt ? `See ${task.title}` : quoted ? `Edit your offer for ${task.title}` : `Apply for ${task.title}`}
        style={{ width: 90, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.btn }}
      >
        <RNText style={tx('800', 13, t.colors.onBtn)}>{button}</RNText>
      </Pressy>
    </Pressy>
  );
}

/** The distance choices as one segmented control, for the "Jobs near" card's header. */
export function RadiusSegments({ radii, value, onPick }: { radii: number[]; value: number; onPick: (km: number) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', padding: 3, borderRadius: 10, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line }}>
      {radii.map((km) => {
        const on = value === km;
        return (
          <Pressable
            key={km}
            onPress={() => onPick(km)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: on ? t.colors.surface : 'transparent' }}
          >
            <RNText style={tx(on ? '800' : '600', 12.5, on ? t.colors.accentDeep : t.colors.text)}>{km} km</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * "On the go" (WebEarn rail): the worker's jobs in hand and offers waiting for an answer, from the same reads
 * and labels as My Work (lib/taskRows). Signed-in workers only.
 */
export function OnTheGoCard() {
  const t = useTheme();
  const { go } = useNav();
  const { flash, setOpenTask, startedOf } = useApp();
  const { userId } = useAuth();
  const tick = useFocusTick();
  const [rows, setRows] = useState<ViewRow[] | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void Promise.all([listMyAssignments(userId), listMyBids(userId)])
      .then(([assignments, bids]) => {
        if (!alive) return;
        const assigned = new Set(assignments.map((a) => a.task_id));
        const all = [...assignments.map(workerAssignmentRow), ...bids.filter((b) => !assigned.has(b.task_id)).map(workerBidRow)];
        // In hand first (bucket 1), then offers still waiting (bucket 2); closed ones stay on My Work.
        setRows([...all.filter((r) => r.bucket === 1), ...all.filter((r) => r.bucket === 2)].slice(0, 4));
      })
      .catch(() => alive && setRows((cur) => cur ?? []));
    return () => {
      alive = false;
    };
  }, [userId, tick]);
  if (!userId) return null;
  return (
    <RailCard title="On the go" link="Open My Work" onLink={() => go('myTasks')}>
      {rows === null ? null : rows.length === 0 ? (
        <RNText style={tx('500', 12.5, t.colors.muted, { paddingHorizontal: 16, paddingVertical: 12 })}>
          Nothing on the go yet. Jobs you apply for show here.
        </RNText>
      ) : (
        rows.map((row, i) => (
          <RailRow
            key={`${row.taskId}-${i}`}
            first={i === 0}
            title={row.title}
            sub={row.meta}
            // A waiting offer opens on My Work, where it can be edited; a job in hand opens like it does there.
            onPress={() => (row.bucket === 2 ? go('myTasks') : openRow(row, { go, flash, setOpenTask, startedOf }))}
          />
        ))
      )}
    </RailCard>
  );
}

/**
 * "How TaskDrop works for earning" (WebEarn rail): opens the existing How sheet (Earn side) and the walkthrough.
 * The steps themselves live in components/HowItWorks, shown by the sheet.
 */
export function EarnHowCard({ onSteps }: { onSteps: () => void }) {
  const t = useTheme();
  const { go } = useNav();
  return (
    <View style={[cardSurface(t, 16), { padding: 16, gap: 10 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 999, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="help" size={14} color={t.colors.accentDeep} />
        </View>
        <RNText accessibilityRole="header" style={tx('800', 14.5, t.colors.ink, { flex: 1 })}>
          How TaskDrop works for earning
        </RNText>
      </View>
      <RNText style={tx('500', 12.5, t.colors.muted, { lineHeight: 18 })}>
        Step by step, from finding a job to getting paid.
      </RNText>
      <Pressable onPress={onSteps} accessibilityRole="button" hitSlop={6}>
        <RNText style={tx('700', 13, t.colors.accentDeep)}>See the steps ›</RNText>
      </Pressable>
      <Pressable onPress={() => go('intro', { replay: true })} accessibilityRole="button" hitSlop={6}>
        <RNText style={tx('700', 13, t.colors.accentDeep)}>Play the walkthrough ›</RNText>
      </Pressable>
    </View>
  );
}
