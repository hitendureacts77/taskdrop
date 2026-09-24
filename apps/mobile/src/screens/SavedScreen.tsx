import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { Screen } from '../components/ui';
import { EmptyState, Shimmer, TopBar } from '../components/kit';
import { WorkCard } from '../components/WorkCard';
import { BidSheet } from '../components/BidSheet';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { useMode } from '../providers/ModeProvider';
import { attachPosters, type Task, type TaskWithPoster } from '../data/api';
import { listSavedTasks, setSaved } from '../data/extras';
import { taskToFeedRow } from '../lib/openTask';

/** Tasks saved for later, from the bookmark on any task card. */
export function SavedScreen() {
  const { back, go } = useNav();
  const { flash } = useApp();
  const { setMode } = useMode();
  const [rows, setRows] = useState<TaskWithPoster[] | null>(null);
  const [bidTask, setBidTask] = useState<Task | null>(null);

  useEffect(() => {
    let alive = true;
    listSavedTasks()
      .then(attachPosters)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  const unsave = async (id: string) => {
    setRows((r) => (r ?? []).filter((x) => x.id !== id));
    try {
      await setSaved(id, false);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update saved');
    }
  };

  return (
    <Screen padded={false}>
      <TopBar title="Saved tasks" subtitle="Tasks you saved for later" onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
        {rows === null ? (
          <Shimmer height={120} />
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
