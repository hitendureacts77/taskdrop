import { useEffect, useState } from 'react';
import { ScrollView, Text as RNText } from 'react-native';
import { Screen } from '../components/ui';
import { EmptyState, Grid, Shimmer, TopBar } from '../components/kit';
import { tx } from '../components/primitives';
import { ListPage } from '../components/ListPage';
import { CONTENT_INSET } from '../navigation/DesktopPage';
import { useLayout } from '../lib/layout';
import { useTheme } from '../providers/ThemeProvider';
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

// The desktop page's scroll content: ListPage's own padding, plus the inset the page header's content sits at.
const LIST_SCROLL = { paddingTop: 8, paddingBottom: 28, paddingHorizontal: CONTENT_INSET } as const;

/** Tasks saved for later, from the bookmark on any task card. */
export function SavedScreen() {
  const t = useTheme();
  // Desktop: a ListPage (the count in the toolbar, the cards in a grid). Everywhere else the screen is drawn as before.
  const { desktop } = useLayout();
  const { back, go } = useNav();
  const { flash } = useActions();
  const { setMode } = useMode();
  const { guest, userId } = useAuth();
  const [rows, setRows] = useState<TaskWithPoster[] | null>(null);
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const offers = useMyOffers(userId, (rows ?? []).map((r) => r.id), !guest);

  useEffect(() => {
    let alive = true;
    (guest ? loadGuestSavedTasks(getTask) : listSavedTasks())
      .then((r) => attachPosters(r))
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [guest]);

  const unsave = async (id: string) => {
    setRows((r) => (r ?? []).filter((x) => x.id !== id));
    try {
      if (guest) await setGuestSaved(id, false);
      else await setSaved(id, false);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update saved');
    }
  };

  const cards = (rows ?? []).map((task, i) => (
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
  ));

  const content =
    rows === null ? (
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
    ) : desktop ? (
      <Grid>{cards}</Grid>
    ) : (
      cards
    );

  return (
    <Screen padded={false}>
      <TopBar title="Saved tasks" subtitle="Tasks you saved for later" onBack={back} />
      {desktop ? (
        <ListPage
          scrollProps={{ contentContainerStyle: LIST_SCROLL }}
          toolbar={{
            right:
              rows && rows.length > 0 ? (
                <RNText style={tx('600', 13, t.colors.muted, { fontVariant: ['tabular-nums'] })}>
                  {rows.length === 1 ? '1 saved task' : `${rows.length} saved tasks`}
                </RNText>
              ) : undefined,
          }}
        >
          {content}
        </ListPage>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>{content}</ScrollView>
      )}
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} />
    </Screen>
  );
}
