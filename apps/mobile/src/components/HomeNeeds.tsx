import { useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { posterEscrowCharge } from '@taskdrop/rules';
import { useTheme } from '../providers/ThemeProvider';
import { useFocusTick, useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { listMyAssignments, listMyBids, type Task } from '../data/api';
import { openPostedTask, openRow, workerAssignmentRow, workerBidRow, type ViewRow } from '../lib/taskRows';
import { posterNeeds, workerNeeds, type Need } from '../lib/myTasksBoard';
import { useFees } from '../lib/useFees';
import { HitArea, tx } from './primitives';
import { formatINR } from './ui';
import { NeedsNow } from './myTasks/NeedsNow';

/**
 * "Needs you now" on Home (task 1.19 F): the same list and rows as the top of My tasks / My work (lib/myTasksBoard,
 * components/myTasks/NeedsNow), the most pressing two, with a link to the rest. Built only from reads Home already
 * makes (Hire) or the two My work reads (Earn). Nothing waiting: nothing drawn.
 */

/** How many rows Home shows; the rest are one tap away in My tasks / My work. */
const ON_HOME = 2;

/** The poster's list, from Home's own read of their live tasks and the offers on each open one. */
export function usePosterNeeds(tasks: Task[] | null, offers: Map<string, number>, guest: boolean): Need[] {
  const fees = useFees();
  return useMemo(
    () =>
      guest || !tasks
        ? []
        : posterNeeds(tasks, {
            offersOf: (id) => offers.get(id) ?? 0,
            // Home does not look the hired person up; the rows then say "the worker".
            nameOf: () => null,
            payText: (x) => formatINR(posterEscrowCharge((x as Task).locked_minor ?? (x as Task).benchmark_minor, fees.posterFee)),
            now: Date.now(),
          }),
    [tasks, offers, guest, fees.posterFee],
  );
}

/** The worker's list: jobs to start, jobs to finish with proof, offers waiting (the same reads as My work). */
export function useWorkerNeeds(): { items: Need[]; rows: ViewRow[] } {
  const { userId, guest } = useAuth();
  const tick = useFocusTick();
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [due, setDue] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    if (!userId || guest) {
      setRows([]);
      return;
    }
    let alive = true;
    void Promise.all([listMyAssignments(userId), listMyBids(userId)])
      .then(([assignments, bids]) => {
        if (!alive) return;
        const assigned = new Set(assignments.map((a) => a.task_id));
        setRows([...assignments.map(workerAssignmentRow), ...bids.filter((b) => !assigned.has(b.task_id)).map(workerBidRow)]);
        const map = new Map<string, string | null>();
        for (const a of assignments) map.set(a.task_id, a.tasks?.due_at ?? null);
        setDue(map);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, guest, tick]);
  const items = useMemo(
    () => workerNeeds(rows, { dueOf: (id) => (id ? due.get(id) : null), pendingOffers: rows.filter((r) => r.bucket === 2).length, now: Date.now() }),
    [rows, due],
  );
  return { items, rows };
}

/**
 * The card: NeedsNow's own rows (the top two), then "All N in My tasks ›". `inset`: the phone column already pads
 * 20 px each side, and NeedsNow pads itself, so it is pulled back out.
 */
export function HomeNeedsNow({
  items,
  side,
  onPick,
  allCount,
  inset = true,
}: {
  items: Need[];
  side: 'hire' | 'earn';
  onPick: (n: Need) => void;
  /** Everything live in My tasks / My work, for the link. */
  allCount: number;
  inset?: boolean;
}) {
  const t = useTheme();
  const { go } = useNav();
  if (items.length === 0) return null;
  const where = side === 'hire' ? 'My tasks' : 'My work';
  return (
    <View testID="home-needs-now" style={{ marginHorizontal: inset ? -20 : 0 }}>
      <NeedsNow items={items.slice(0, ON_HOME)} onPick={onPick} desktop={false} side={side} />
      <Pressable
        onPress={() => go('myTasks')}
        accessibilityRole="button"
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        style={{ alignSelf: 'flex-end', marginRight: 20, marginTop: 8 }}
      >
        <HitArea x={8} y={10} />
        <RNText style={tx('700', 13, t.colors.accentDeep)}>
          {allCount > 0 ? `All ${allCount} in ${where} ›` : `All in ${where} ›`}
        </RNText>
      </Pressable>
    </View>
  );
}

/** What a tap on a poster's row does: the same as on My tasks. */
export function usePosterNeedPick(tasks: Task[] | null) {
  const { go } = useNav();
  return (n: Need) => {
    const task = (tasks ?? []).find((x) => x.id === n.taskId);
    if (!task) return go('myTasks');
    if (n.kind === 'repost') return go('aiPost', { similar: task });
    openPostedTask(task, go);
  };
}

/** What a tap on a worker's row does: the same as on My work (offers waiting open My work). */
export function useWorkerNeedPick(rows: ViewRow[]) {
  const { go } = useNav();
  const { flash, setOpenTask, startedOf } = useApp();
  return (n: Need) => {
    if (n.kind === 'offers') return go('myTasks');
    const row = rows.find((r) => r.taskId === n.taskId && r.bucket === 1);
    if (row) openRow(row, { go, flash, setOpenTask, startedOf });
    else go('myTasks');
  };
}
