import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { Screen } from '../components/ui';
import { EmptyState, Shimmer, TopBar } from '../components/kit';
import { WorkCard } from '../components/WorkCard';
import { BidSheet } from '../components/BidSheet';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { useMode } from '../providers/ModeProvider';
import { attachPosters, getTask, type Task, type TaskWithPoster } from '../data/api';
import { useAuth } from '../providers/AuthProvider';
import { loadGuestSavedTasks, setGuestSaved } from '../lib/guestSaves';
import { listSavedTasks, setSaved } from '../data/extras';
import { taskToFeedRow } from '../lib/openTask';
import { useMyOffers } from '../lib/useMyOffers';

/** Tasks saved for later, from the bookmark on any task card. */
export function SavedScreen() {
  const { back, go } = useNav();
  const { flash } = useActions();
  const { setMode } = useMode();
  const { guest, userId } = useAuth();
  const [rows, setRows] = useState<TaskWithPoster[] | null>(null);
  const [bidTask, setBidTask] = useState<Task | null>(null);
  // S5-35: a failed read is not "nothing saved yet".
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const offers = useMyOffers(userId, (rows ?? []).map((r) => r.id), !guest);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    (guest ? loadGuestSavedTasks(getTask) : listSavedTasks())
      .then((r) => attachPosters(r))
      .then((r) => alive && setRows(r))
      .catch(() => {
        if (!alive) return;
        setRows([]);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [guest, tick]);

  const unsave = async (id: string) => {
    const before = rows;
    setRows((r) => (r ?? []).filter((x) => x.id !== id));
    try {
      if (guest) await setGuestSaved(id, false);
      else await setSaved(id, false);
    } catch (e) {
      // Put the card back: it is still saved on the server.
      setRows(before);
      flash(e instanceof Error ? e.message : 'Could not update saved');
    }
  };

  return (
    <Screen padded={false}>
      <TopBar title="Saved tasks" subtitle="Tasks you saved for later" onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
        {rows === null ? (
          <Shimmer height={120} />
        ) : failed ? (
          <EmptyState
            icon="bookmark"
            title="Could not load your saved tasks"
            body="Check your connection and try again."
            actionLabel="Try again"
            onAction={() => {
              setRows(null);
              setTick((n) => n + 1);
            }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="bookmark"
            title="Nothing saved yet"
            body="Tap the bookmark on any task to keep it here."
            actionLabel="Find work"
            onAction={() => {
              setMode('worker');
              go('explore');
            }}
          />
        ) : (
          rows.map((task, i) => (
            <WorkCard
              key={task.id}
              task={task}
              index={i}
              saved
              quoted={offers.has(task.id)}
              onOpen={() => go('taskDetail', { row: taskToFeedRow(task) })}
              onApply={() => setBidTask(task)}
              onToggleSave={() => void unsave(task.id)}
            />
          ))
        )}
      </ScrollView>
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} />
    </Screen>
  );
}
