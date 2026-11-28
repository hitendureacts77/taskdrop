/**
 * The public link for a task and the words that go with it when a poster shares it (task 128).
 *
 * Pure (no React Native), so it can be unit tested. lib/links.ts picks the site origin; this file only builds
 * the link and the message from it.
 *
 * Privacy: the message names the task and its rough area ("Kondapur, Hyderabad"), never the door-level address.
 * The area comes from roughPlace (lib/place.ts), passed in as `rough` so this file stays free of imports.
 */

/** Staging's web address: where a phone build without EXPO_PUBLIC_APP_URL sends its links. */
export const STAGING_SITE = 'https://taskdrop.in';

/** The line that asks for help, between the task and its link. */
export const SHARE_ASK = 'Can you help? Send an offer on TaskDrop:';

/** A task's public page on the website: <origin>/task/<id>. Null when there is no usable origin or id. */
export function taskLink(origin: string | null | undefined, taskId: string | null | undefined): string | null {
  const base = (origin ?? '').trim().replace(/[/]+$/, '');
  if (!/^https?:\/\/[^/\s]+$/i.test(base)) return null;
  const id = (taskId ?? '').trim();
  if (!id) return null;
  return `${base}/task/${encodeURIComponent(id)}`;
}

type SharedTask = { id: string; title: string; loc_label?: string | null };

export type TaskShare = { title: string; message: string; url: string };

/**
 * What a poster shares: the title (with the rough area when there is one), the ask, and the link.
 * The share sheet adds the link on its own line after the message.
 */
export function taskShare(
  task: SharedTask,
  origin: string | null | undefined,
  rough: (label: string | null) => string | null,
): TaskShare | null {
  const url = taskLink(origin, task.id);
  if (!url) return null;
  const title = task.title.trim() || 'A task on TaskDrop';
  const area = rough(task.loc_label ?? null);
  const headline = area ? `${title} (${area})` : title;
  return { title, message: `${headline}\n${SHARE_ASK}`, url };
}
