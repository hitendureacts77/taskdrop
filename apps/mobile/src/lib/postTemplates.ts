/**
 * "Save as template" (Ideas board): a poster keeps one of their own tasks as a starting point, and the
 * posting flow shows it under "Your templates". Kept only on this device, for this account; sign-out
 * forgets them (like drafts, B31). Nothing goes to the server: posting from a template is an ordinary post.
 *
 * Plain functions over a small storage shape, so the node test runner can load this file.
 */

export type PostTemplate = {
  id: string;
  title: string;
  description: string;
  category: string;
  /** The budget in whole rupees; 0 = none kept. */
  budget: number;
  savedAt: number;
};

/** The part of AsyncStorage this file uses. */
export type TemplateStorage = {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
  removeItem: (k: string) => Promise<void>;
};

export const templatesKey = (userId: string) => `taskdrop.postTemplates.v1.${userId}`;
/** The most kept per account; the oldest goes first. */
export const MAX_TEMPLATES = 8;

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;
const BUDGET_MAX = 1_000_000;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const rupees = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(BUDGET_MAX, Math.max(0, Math.round(v))) : 0);

/** One saved row made safe, or null when it has no title. */
function clean(v: unknown): PostTemplate | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const title = text(r.title, TITLE_MAX);
  if (!title || typeof r.id !== 'string') return null;
  return {
    id: r.id,
    title,
    description: text(r.description, DESCRIPTION_MAX),
    category: text(r.category, 60) || 'Other',
    budget: rupees(r.budget),
    savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0,
  };
}

/** What was stored, made safe and newest first; anything odd is dropped. */
export function parseTemplates(raw: string | null | undefined): PostTemplate[] {
  if (!raw) return [];
  try {
    const rows = JSON.parse(raw) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows
      .map(clean)
      .filter((r): r is PostTemplate => r !== null)
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX_TEMPLATES);
  } catch {
    return [];
  }
}

/** The list with this one added at the top; one with the same title is replaced, not doubled. */
export function addTemplate(
  rows: PostTemplate[],
  input: { title: string; description?: string | null; category?: string | null; budget?: number | null },
  now: number = Date.now(),
): PostTemplate[] {
  const row = clean({ ...input, id: `t${now.toString(36)}`, savedAt: now });
  if (!row) return rows;
  const same = (a: string) => a.toLowerCase() === row.title.toLowerCase();
  const rest = rows.filter((r) => !same(r.title));
  // Two saves in the same millisecond still get their own ids, so removing one never removes the other.
  for (let n = 1; rest.some((r) => r.id === row.id); n++) row.id = `t${now.toString(36)}-${n}`;
  return [row, ...rest].slice(0, MAX_TEMPLATES);
}

export async function listTemplates(storage: TemplateStorage, userId: string): Promise<PostTemplate[]> {
  try {
    return parseTemplates(await storage.getItem(templatesKey(userId)));
  } catch {
    return [];
  }
}

/** Keeps a template for this account. Returns false when it could not be kept. */
export async function saveTemplate(
  storage: TemplateStorage,
  userId: string,
  input: { title: string; description?: string | null; category?: string | null; budget?: number | null },
): Promise<boolean> {
  try {
    const rows = addTemplate(await listTemplates(storage, userId), input);
    await storage.setItem(templatesKey(userId), JSON.stringify(rows));
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function removeTemplate(storage: TemplateStorage, userId: string, id: string): Promise<void> {
  try {
    const rows = (await listTemplates(storage, userId)).filter((r) => r.id !== id);
    await storage.setItem(templatesKey(userId), JSON.stringify(rows));
  } catch {
    // Left as it was: still shown only to this account.
  }
}

/** Sign-out: the next person on this phone or browser never finds them. */
export async function clearTemplates(storage: TemplateStorage, userId: string): Promise<void> {
  try {
    await storage.removeItem(templatesKey(userId));
  } catch {
    // Left behind: still shown only to that same account.
  }
}
