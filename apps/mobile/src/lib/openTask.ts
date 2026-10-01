import type { TaskWithPoster } from '../data/api';
import type { FeedRow } from '../screens/HomeScreen';
import { formatDeadline } from '../components/DateTimeSheet';

const PILLAR_TAG: Record<string, FeedRow['tag']> = {
  services: 'SERVICES',
  procurement: 'PRODUCTS',
  local_intel: 'LOCAL HELP',
};

/**
 * A task in the shape the existing task-detail screen takes, so every new
 * list opens tasks on the same page the feed always has.
 */
export function taskToFeedRow(task: TaskWithPoster): FeedRow {
  const place = task.loc_label?.split(',').slice(-2).join(',').trim() || null;
  return {
    id: task.id,
    sponsored: false,
    adRank: 0,
    who: task.poster?.display_name ?? 'Customer',
    rating:
      task.poster && task.poster.poster_rating_count > 0
        ? Number(task.poster.poster_rating_avg).toFixed(1)
        : 'new',
    whoMeta: task.poster?.loc_label?.split(',').slice(-2).join(',').trim() || 'new here',
    tag: PILLAR_TAG[task.pillar] ?? 'SERVICES',
    title: task.title,
    meta: task.flag === 'urgent' ? 'Urgent' : (place ?? 'Location not shared'),
    amountMinor: task.benchmark_minor,
    hasMedia: Boolean(task.media_path),
    glyph: task.media_kind === 'video' ? '▶' : task.media_path ? '▤' : '',
    mediaPath: task.media_path ?? null,
    mediaKind: task.media_kind === 'video' || task.media_kind === 'image' ? task.media_kind : null,
    mediaSeconds: task.media_seconds ?? null,
    dur: task.media_seconds ? `${task.media_seconds}s` : null,
    body: task.description ?? '',
    by: task.due_at ? formatDeadline(new Date(task.due_at)) : null,
  };
}
