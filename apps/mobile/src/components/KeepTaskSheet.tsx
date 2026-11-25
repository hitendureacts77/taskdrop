import { Text as RNText } from 'react-native';
import { BottomSheet, MenuRow, PrimaryButton } from './kit';
import { Pressy, tx } from './primitives';
import { ShareSheet, useShare } from './ShareSheet';
import { formatINR } from './ui';
import { useTheme } from '../providers/ThemeProvider';
import { keepTaskBody, keepTaskOptions, type KeepTaskOptionId } from '../lib/keepTask';
import { taskUrl } from '../lib/links';
import type { Task } from '../data/api';

type KeepTask = Pick<Task, 'id' | 'title' | 'status' | 'kind' | 'topup_pct' | 'benchmark_minor'>;

const ICONS = { topup: 'plus', share: 'share', similar: 'copy', message: 'chat' } as const;

/**
 * "Give your task one more go?" (task 1.19 row A): shown when a poster taps Delete task, before the final
 * confirm. Only "Delete anyway" goes on to the confirm dialog. The screen owns what Top up, Post again and
 * Message do (it knows its own state); Share is handled here.
 */
export function KeepTaskSheet({
  task,
  hasWorker,
  flash,
  onKeep,
  onDelete,
  onTopUp,
  onSimilar,
  onMessage,
}: {
  task: KeepTask | null;
  hasWorker: boolean;
  flash: (msg: string) => void;
  onKeep: () => void;
  onDelete: () => void;
  onTopUp: (task: KeepTask) => void;
  onSimilar: (task: KeepTask) => void;
  onMessage?: (task: KeepTask) => void;
}) {
  const t = useTheme();
  const share = useShare(flash);
  const options = task ? keepTaskOptions(task, hasWorker && Boolean(onMessage), formatINR) : [];

  const pick = (id: KeepTaskOptionId) => {
    if (!task) return;
    onKeep();
    if (id === 'topup') onTopUp(task);
    else if (id === 'similar') onSimilar(task);
    else if (id === 'message') onMessage?.(task);
    else {
      const url = taskUrl(task.id);
      share.start(url ? { title: task.title, message: `${task.title} · ${formatINR(task.benchmark_minor)} on TaskDrop`, url } : null);
    }
  };

  return (
    <>
      <BottomSheet visible={task !== null} onClose={onKeep} title="Give your task one more go?">
        {task ? (
          <>
            <RNText style={tx('500', 13, t.colors.muted, { lineHeight: 19, marginBottom: 6 })}>{keepTaskBody(task.status)}</RNText>
            {options.map((o) => (
              <MenuRow key={o.id} icon={ICONS[o.id]} label={o.label} sub={o.sub} onPress={() => pick(o.id)} />
            ))}
            <PrimaryButton label="Keep my task" onPress={onKeep} style={{ marginTop: 12 }} />
            <Pressy onPress={onDelete} label="Delete anyway" style={{ alignItems: 'center', paddingVertical: 14 }}>
              <RNText style={tx('600', 14, t.colors.signalDeep)}>Delete anyway</RNText>
            </Pressy>
          </>
        ) : null}
      </BottomSheet>
      <ShareSheet visible={share.open} item={share.item} onClose={share.close} flash={flash} />
    </>
  );
}
