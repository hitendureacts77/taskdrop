import { useEffect, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { BottomSheet, MenuRow, Shimmer } from './kit';
import { tx } from './primitives';
import { formatINR } from './ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { listMyTasks, notifyHelperAboutTask, type Task } from '../data/api';
import { messageOf } from '../lib/errors';

export type NotifyHelper = {
  id: string;
  name: string;
  /** A finished task to start the new post from ("Notify about a task" on a My tasks card). */
  similar?: Task;
};

/**
 * "Notify about a task" (task 1.21 row C, owner 27 Nov 2026): pick one of your open tasks, or post a new
 * one, and this person gets one notification with its link. Nothing is reserved for them: the task stays
 * open to everyone, and they send an offer like anyone else. The server allows it only for someone you
 * hired before, never for a blocked or deleted person, and once per person per task (migration 231).
 */
export function NotifyHelperSheet({
  helper,
  onClose,
  flash,
}: {
  helper: NotifyHelper | null;
  onClose: () => void;
  flash: (msg: string) => void;
}) {
  const t = useTheme();
  const { go } = useNav();
  const { userId } = useAuth();
  const [open, setOpen] = useState<Task[] | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    if (!helper || !userId) return;
    let alive = true;
    setOpen(null);
    listMyTasks(userId, 'request')
      .then((all) => alive && setOpen(all.filter((x) => x.status === 'OPEN')))
      .catch(() => alive && setOpen([]));
    return () => {
      alive = false;
    };
  }, [helper, userId]);

  const first = helper?.name.split(' ')[0] ?? '';

  const send = async (task: Task) => {
    if (!helper || sending) return;
    setSending(task.id);
    try {
      const r = await notifyHelperAboutTask(task.id, helper.id);
      flash(r.already ? `${first} was already told about this task` : `${first} was notified. Your task stays open to everyone`);
      onClose();
    } catch (e) {
      flash(messageOf(e, 'Could not notify them. Try again'));
    } finally {
      setSending(null);
    }
  };

  const postNew = () => {
    if (!helper) return;
    onClose();
    const preferWorker = { id: helper.id, name: helper.name };
    go('aiPost', helper.similar ? { similar: helper.similar, preferWorker } : { preferWorker });
  };

  return (
    <BottomSheet visible={helper !== null} onClose={onClose} title={`Notify ${first} about a task`}>
      <RNText style={tx('500', 13, t.colors.muted, { lineHeight: 19, marginBottom: 6 })}>
        {first} gets a notification with the link. Your task stays open to everyone.
      </RNText>
      {open === null ? (
        <View style={{ gap: 8, marginTop: 6 }}>
          <Shimmer height={52} />
          <Shimmer height={52} />
        </View>
      ) : (
        open.map((task) => (
          <MenuRow
            key={task.id}
            icon="send"
            label={task.title}
            sub={sending === task.id ? 'Sending…' : `Open · ${formatINR(task.benchmark_minor)}`}
            onPress={() => void send(task)}
          />
        ))
      )}
      <MenuRow icon="plus" label="Post a new task" sub={`${first} is notified when it goes live`} onPress={postNew} />
    </BottomSheet>
  );
}
