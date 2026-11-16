/**
 * Where a shared task link (?task=<id>) lands (B148). A task that exists opens on its page; one that does not (gone,
 * closed, never existed, or the read failed) opens the same page with a plain "That task is not available" and a way
 * back, instead of silently showing Home. Pure, so it can be unit tested.
 */

export const TASK_UNAVAILABLE = 'That task is not available';

type LinkedTask = {
  id: string;
  title: string;
  description: string;
  loc_label: string | null;
  benchmark_minor: number;
};

export type TaskLinkTarget =
  | { screen: 'taskDetail'; params: { row: Record<string, unknown> } }
  | { screen: 'taskDetail'; params: { unavailable: true } };

export function taskLinkTarget(task: LinkedTask | null | undefined, rough: (label: string | null) => string | null): TaskLinkTarget {
  if (!task) return { screen: 'taskDetail', params: { unavailable: true } };
  const area = rough(task.loc_label) ?? '';
  return {
    screen: 'taskDetail',
    params: {
      row: {
        id: task.id,
        sponsored: false,
        who: 'Customer',
        rating: '—',
        whoMeta: area,
        tag: 'SERVICES',
        title: task.title,
        meta: area,
        amountMinor: task.benchmark_minor,
        hasMedia: false,
        glyph: '',
        dur: null,
        body: task.description,
        by: null,
      },
    },
  };
}
