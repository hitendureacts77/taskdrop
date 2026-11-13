import type { PickedPlace } from '../components/LocationSheet';
import type { PosterOptions } from '../components/PosterOptionsStep';
import type { HuntNeed, HuntWindow } from './hunt';
import type { TaskMedia } from './media';
import type { Answer, Brief, QuickQuestion, WhenKey, WritingStyle } from './taskBrief';

/**
 * Everything typed and chosen on the "Post a request" steps, as one plain
 * object, so a half-made post survives the screen being closed under it:
 * signing in or making an account from the guest pop-up, the Google round
 * trip (a full page reload on the web) or a reload by hand.
 *
 * Pure and free of React Native so it can be unit tested (postWizard.test.ts).
 * lib/postWizardStore.ts keeps it on the device.
 *
 * Nothing about money is kept beyond what the poster typed: the wallet balance
 * and any top-up shortfall are asked again when posting.
 */

export const WIZARD_VERSION = 1;

export type WizardPhase = 'what' | 'picks' | 'brief' | 'when' | 'budget' | 'providers' | 'options' | 'review';
export const WIZARD_PHASES: readonly WizardPhase[] = ['what', 'picks', 'brief', 'when', 'budget', 'providers', 'options', 'review'];

/** Who a snapshot belongs to: an account id, or 'guest' (the same id lib/guest.ts keeps guest drafts under). */
export const GUEST_OWNER = 'guest';

export type WizardSnapshot = {
  v: typeof WIZARD_VERSION;
  owner: string;
  savedAt: number;
  phase: WizardPhase;
  reached: number;
  prompt: string;
  questions: QuickQuestion[];
  askedFor: string | null;
  answers: Answer[];
  brief: Brief | null;
  writtenFrom: string | null;
  title: string;
  description: string;
  category: string;
  style: WritingStyle;
  /** The uploaded file's bucket path only; never a URL (those are signed on demand). */
  media: TaskMedia | null;
  whenKey: WhenKey | 'custom';
  /** ISO time, only for whenKey 'custom'. */
  customDue: string | null;
  budget: number | null;
  topUpStop: number;
  split: 0 | 2 | 3 | 4 | 5 | 6;
  mode: 'bids' | 'auto';
  place: PickedPlace | null;
  /** Where the place came from when it was filled in for the poster ('home' shows a HOME label). */
  placeSource: 'home' | 'profile' | null;
  remote: boolean;
  opts: PosterOptions;
  draftId: string | null;
  /** Set when "Post my request" was pressed as a guest: post it once the account exists. */
  submitAfterAuth: boolean;
};

const DAY = 24 * 3600_000;
/** Older than this, a snapshot is dropped rather than offered back. */
export const STALE_AFTER_MS = 7 * DAY;
/** "Post when back" only counts this long after the press; after that it just reopens on Review. */
export const RESUME_WINDOW_MS = 2 * 3600_000;

const WHEN_KEYS = ['now', 'today', '2days', 'week', 'custom'];
const SPLITS = [0, 2, 3, 4, 5, 6];
const DEFAULT_OPTS: PosterOptions = {
  flash: false,
  liveAnswer: false,
  crewSize: 0,
  repeat: null,
  preferWorker: null,
  wantPhotos: false,
  photosPublic: false,
  hunt: null,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strOrNull = (v: unknown): v is string | null => v === null || isStr(v);
const numOrNull = (v: unknown): v is number | null => v === null || isNum(v);

function validQuestions(v: unknown): v is QuickQuestion[] {
  return Array.isArray(v) && v.every((q) => isObj(q) && isStr(q.question) && Array.isArray(q.options) && q.options.every(isStr));
}
function validAnswers(v: unknown): v is Answer[] {
  return Array.isArray(v) && v.every((a) => isObj(a) && isStr(a.question) && isStr(a.answer));
}
function validMedia(v: unknown): v is TaskMedia | null {
  if (v === null) return true;
  if (!isObj(v) || (v.kind !== 'image' && v.kind !== 'video') || !isStr(v.path) || !v.path) return false;
  // A bucket path, never a link or a local file.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v.path)) return false;
  return v.seconds === undefined || isNum(v.seconds);
}
function validPlace(v: unknown): v is PickedPlace | null {
  if (v === null) return true;
  return isObj(v) && isStr(v.label) && numOrNull(v.lat) && numOrNull(v.lng) && (v.area === undefined || isStr(v.area));
}
function validHunt(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  return (
    isObj(v) &&
    (v.window === '2h' || v.window === 'today' || v.window === '3d') &&
    Array.isArray(v.needs) &&
    v.needs.length > 0 &&
    v.needs.every((n) => n === 'photo' || n === 'place' || n === 'pin' || n === 'price')
  );
}
function readOpts(v: unknown): PosterOptions | null {
  if (!isObj(v)) return null;
  const o = { ...DEFAULT_OPTS, ...v } as Obj;
  const prefer = o.preferWorker;
  if (
    typeof o.flash !== 'boolean' ||
    typeof o.liveAnswer !== 'boolean' ||
    !isNum(o.crewSize) ||
    (o.repeat !== null && o.repeat !== 'week' && o.repeat !== 'month') ||
    (prefer !== null && !(isObj(prefer) && isStr(prefer.id) && isStr(prefer.name))) ||
    typeof o.wantPhotos !== 'boolean' ||
    typeof o.photosPublic !== 'boolean' ||
    !validHunt(o.hunt)
  ) {
    return null;
  }
  const hunt = isObj(o.hunt) ? o.hunt : null;
  return {
    flash: o.flash,
    liveAnswer: o.liveAnswer,
    crewSize: o.crewSize,
    repeat: o.repeat as PosterOptions['repeat'],
    preferWorker: prefer ? { id: (prefer as Obj).id as string, name: (prefer as Obj).name as string } : null,
    wantPhotos: o.wantPhotos,
    photosPublic: o.photosPublic,
    hunt: hunt ? { window: hunt.window as HuntWindow, needs: [...(hunt.needs as HuntNeed[])] } : null,
  };
}

/** A stored snapshot back as a typed one, or null when it is not one this version wrote. */
export function validateSnapshot(raw: unknown): WizardSnapshot | null {
  let v = raw;
  if (isStr(v)) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!isObj(v) || v.v !== WIZARD_VERSION) return null;
  const opts = readOpts(v.opts);
  const ok =
    isStr(v.owner) &&
    v.owner.length > 0 &&
    isNum(v.savedAt) &&
    WIZARD_PHASES.includes(v.phase as WizardPhase) &&
    isNum(v.reached) &&
    Number.isInteger(v.reached) &&
    v.reached >= 0 &&
    v.reached < WIZARD_PHASES.length &&
    isStr(v.prompt) &&
    validQuestions(v.questions) &&
    strOrNull(v.askedFor) &&
    validAnswers(v.answers) &&
    (v.brief === null || (isObj(v.brief) && isStr(v.brief.title) && isStr(v.brief.category))) &&
    strOrNull(v.writtenFrom) &&
    isStr(v.title) &&
    isStr(v.description) &&
    isStr(v.category) &&
    isStr(v.style) &&
    validMedia(v.media) &&
    WHEN_KEYS.includes(v.whenKey as string) &&
    strOrNull(v.customDue) &&
    (v.customDue === null || Number.isFinite(Date.parse(v.customDue))) &&
    numOrNull(v.budget) &&
    isNum(v.topUpStop) &&
    Number.isInteger(v.topUpStop) &&
    v.topUpStop >= 0 &&
    SPLITS.includes(v.split as number) &&
    (v.mode === 'bids' || v.mode === 'auto') &&
    validPlace(v.place) &&
    (v.placeSource === undefined || v.placeSource === null || v.placeSource === 'home' || v.placeSource === 'profile') &&
    typeof v.remote === 'boolean' &&
    opts !== null &&
    strOrNull(v.draftId) &&
    typeof v.submitAfterAuth === 'boolean';
  if (!ok) return null;
  return { ...(v as unknown as WizardSnapshot), placeSource: (v.placeSource as WizardSnapshot['placeSource']) ?? null, opts: opts! };
}

/** Too old to offer back (or dated in the future, which a changed clock can do). */
export function isStale(s: WizardSnapshot, now = Date.now()): boolean {
  return now - s.savedAt > STALE_AFTER_MS || s.savedAt - now > DAY;
}

/** "Post my request" was pressed as a guest a short while ago: once signed in, take them back to it. */
export function resumable(s: WizardSnapshot | null | undefined, now = Date.now()): boolean {
  return !!s && s.submitAfterAuth && !isStale(s, now) && now - s.savedAt < RESUME_WINDOW_MS && now >= s.savedAt - 60_000;
}

/** Fixes what time has made wrong: a picked date already gone becomes "today". */
export function normalize(s: WizardSnapshot, now = Date.now()): WizardSnapshot {
  let out = s;
  if (s.whenKey === 'custom') {
    const due = s.customDue ? Date.parse(s.customDue) : NaN;
    if (!Number.isFinite(due) || due <= now) out = { ...out, whenKey: 'today', customDue: null };
  } else if (s.customDue !== null) {
    out = { ...out, customDue: null };
  }
  const at = WIZARD_PHASES.indexOf(out.phase);
  if (out.reached < at) out = { ...out, reached: at };
  return out;
}

/**
 * Whether `viewer` (an account id, 'guest', or null when neither) may see this snapshot.
 * A guest's may be taken over by whoever signs in on this device; one account's is never
 * shown to another account or to a guest.
 */
export function ownerMatches(s: WizardSnapshot, viewer: string | null): boolean {
  if (!viewer) return false;
  if (s.owner === viewer) return true;
  return s.owner === GUEST_OWNER && viewer !== GUEST_OWNER;
}

/** A guest's snapshot, now belonging to the account that signed in. Others are left as they are. */
export function adopt(s: WizardSnapshot, userId: string): WizardSnapshot {
  return s.owner === GUEST_OWNER && userId && userId !== GUEST_OWNER ? { ...s, owner: userId } : s;
}

/**
 * An "At a place" request needs a pinned place, or it never shows on a distance search or the map (B91).
 * A remote request needs none.
 */
export function placeMissing(remote: boolean, place: { lat: number | null; lng: number | null } | null): boolean {
  if (remote) return false;
  return !place || typeof place.lat !== 'number' || typeof place.lng !== 'number' || !Number.isFinite(place.lat) || !Number.isFinite(place.lng);
}

/** The plain words shown while a place is still missing. */
export const PLACE_MISSING_LINE = 'Set where the job is, or switch to Remote / online.';
