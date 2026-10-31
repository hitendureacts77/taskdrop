import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Half-written posts. Leaving the posting flow with something typed keeps the
 * words here, on this device and for this account, and My Tasks lists them under
 * Drafts. Only the request text is kept: the steps after it are asked again,
 * which also refreshes the price and the deadline.
 */
export type PostDraft = { id: string; prompt: string; savedAt: number };

const KEY = (userId: string) => `taskdrop.postDrafts.v1.${userId}`;
const MAX = 10;

export async function listDrafts(userId: string): Promise<PostDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY(userId));
    const rows = raw ? (JSON.parse(raw) as PostDraft[]) : [];
    return rows.filter((d) => d && typeof d.id === 'string' && typeof d.prompt === 'string').sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

async function write(userId: string, rows: PostDraft[]) {
  try {
    await AsyncStorage.setItem(KEY(userId), JSON.stringify(rows.slice(0, MAX)));
  } catch {
    // A draft that cannot be kept is not worth an error: the person is leaving.
  }
}

/** Keeps the text as a draft; an existing draft id is updated in place. Returns its id. */
export async function saveDraft(userId: string, prompt: string, id?: string | null): Promise<string> {
  const text = prompt.trim();
  const rows = (await listDrafts(userId)).filter((d) => d.id !== id && d.prompt !== text);
  const draftId = id || `d${Date.now().toString(36)}`;
  await write(userId, [{ id: draftId, prompt: text, savedAt: Date.now() }, ...rows]);
  return draftId;
}

export async function removeDraft(userId: string, id: string): Promise<void> {
  await write(userId, (await listDrafts(userId)).filter((d) => d.id !== id));
}
