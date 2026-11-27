/**
 * Smart search (plan 1.19 row D): understand what someone is looking for, not only the words they typed.
 *
 * Three layers, ranked together by public.search_posts (migration 223):
 *   1. Words: the searcher's own words plus the words they stand for ("nal" -> tap, plumber), from CONCEPTS below,
 *      which carries everyday Indian English and Hinglish.
 *   2. Spelling slips: "plumbr" is read as "plumber" (fixWords here) and the database also matches close titles.
 *   3. Meaning: a 384-number fingerprint of the search and of each post from Supabase's built-in gte-small model,
 *      which runs inside this Edge Function at no cost. If the model is slow or missing, search runs on 1 and 2.
 *
 * Everything here except embed() is pure and tested in Node/Deno (search.test.ts).
 */

/** One kind of work people ask for, how they say it, and the words posts about it use. */
export type Concept = {
  id: string;
  /** The chip under the search box ("Searching for Plumbing"). */
  label: string;
  /** Words and phrases that point to it, English and Hinglish, lower case. */
  says: string[];
  /** Words a post about it tends to hold; added to the word search and the meaning fingerprint. */
  terms: string[];
  /** Close kinds of work, offered when nothing is found. */
  near?: string[];
};

export const CONCEPTS: Concept[] = [
  { id: "plumbing", label: "Plumbing", says: ["tap", "taps", "nal", "nalka", "plumber", "plumbing", "leak", "leaking", "leakage", "pipe", "pipes", "faucet", "sink", "drain", "blocked drain", "clogged", "toilet", "flush", "commode", "washbasin", "water tank", "tanki", "motor pump", "paani"], terms: ["plumber", "plumbing", "leak", "leaking", "pipe", "tap", "sink", "drain", "faucet", "bathroom", "washer"], near: ["electrical", "handyman"] },
  { id: "electrical", label: "Electrician", says: ["bijli", "electrician", "electric", "electrical", "wiring", "wire", "switch", "socket", "plug", "mcb", "fuse", "light", "tubelight", "fan", "ceiling fan", "regulator", "inverter", "geyser", "short circuit", "trips", "power cut"], terms: ["electrician", "electrical", "wiring", "switch", "socket", "fan", "light", "geyser", "inverter"], near: ["appliance", "handyman"] },
  { id: "ac", label: "AC repair", says: ["ac", "a/c", "aircon", "air conditioner", "air conditioning", "thanda", "cooling", "not cooling", "gas refill", "gas top up", "split ac", "window ac", "ac service"], terms: ["ac", "air conditioner", "cooling", "service", "gas", "refill", "split", "repair"], near: ["appliance", "electrical"] },
  { id: "appliance", label: "Appliance repair", says: ["fridge", "refrigerator", "washing machine", "microwave", "oven", "mixer", "grinder", "ro", "water purifier", "chimney", "dishwasher", "appliance"], terms: ["appliance", "repair", "fridge", "washing machine", "microwave", "service"], near: ["ac", "electrical"] },
  { id: "computer", label: "Computer repair", says: ["laptop", "computer", "pc", "desktop", "slow", "hang", "hanging", "virus", "windows", "format", "ssd", "ram", "macbook", "booting", "not starting", "blue screen"], terms: ["laptop", "computer", "pc", "repair", "slow", "virus", "windows", "ssd", "speed"], near: ["techhelp", "phone"] },
  { id: "phone", label: "Phone repair", says: ["mobile", "phone", "screen broken", "cracked screen", "battery", "charging port", "iphone", "android"], terms: ["phone", "mobile", "screen", "repair", "battery"], near: ["computer"] },
  { id: "techhelp", label: "Tech setup", says: ["wifi", "wi-fi", "router", "internet", "printer", "tv setup", "smart tv", "cctv", "camera install", "set up", "setup", "install app"], terms: ["setup", "install", "wifi", "router", "printer", "tv", "cctv"], near: ["computer"] },
  { id: "delivery", label: "Pickup and drop", says: ["parcel", "courier", "deliver", "delivery", "drop", "pick up", "pickup", "package", "send", "saman", "documents", "cake"], terms: ["delivery", "deliver", "parcel", "courier", "pickup", "drop", "package", "errand"], near: ["errands", "driver"] },
  { id: "errands", label: "Errands", says: ["errand", "queue", "line", "rto", "bank", "medicine", "medicines", "dawai", "pharmacy", "chemist", "grocery", "groceries", "sabzi", "kirana", "bill payment", "post office"], terms: ["errand", "queue", "medicine", "pharmacy", "grocery", "collect", "pickup"], near: ["delivery"] },
  { id: "cleaning", label: "Cleaning", says: ["clean", "cleaning", "cleaner", "maid", "bai", "kaamwali", "kaam wali", "safai", "jhadu", "pocha", "deep clean", "sofa cleaning", "bathroom cleaning", "dusting", "housekeeping"], terms: ["cleaning", "clean", "maid", "house", "deep", "dusting", "mopping"], near: ["pest", "cook"] },
  { id: "cook", label: "Cooking", says: ["cook", "cooking", "khana", "chef", "tiffin", "rasoi", "maharaj", "meal", "food"], terms: ["cook", "cooking", "meal", "food", "chef", "tiffin"], near: ["cleaning", "event"] },
  { id: "carpenter", label: "Carpentry", says: ["carpenter", "furniture", "almirah", "wardrobe", "cupboard", "bed", "door", "hinge", "assemble", "assembly", "ikea", "table", "chair", "shelf", "curtain rod", "badhai"], terms: ["carpenter", "furniture", "assemble", "wood", "door", "repair", "install"], near: ["handyman", "painter"] },
  { id: "handyman", label: "Handyman", says: ["handyman", "drill", "mount", "wall mount", "tv mount", "hang", "fix", "repair", "lock", "jammed"], terms: ["handyman", "drill", "mount", "install", "fix", "repair"], near: ["carpenter", "electrical"] },
  { id: "painter", label: "Painting", says: ["paint", "painting", "painter", "wall", "putty", "whitewash", "polish", "texture"], terms: ["paint", "painting", "painter", "wall", "colour"], near: ["carpenter"] },
  { id: "pest", label: "Pest control", says: ["pest", "cockroach", "cockroaches", "termite", "deemak", "keede", "rats", "mosquito", "bed bugs", "lizard"], terms: ["pest", "control", "cockroach", "termite", "spray"], near: ["cleaning"] },
  { id: "moving", label: "Shifting help", says: ["shifting", "shift", "packers", "movers", "moving", "relocate", "relocation", "tempo", "loading"], terms: ["shifting", "moving", "packers", "movers", "loading", "packing"], near: ["delivery", "driver"] },
  { id: "driver", label: "Driver", says: ["driver", "drive", "gaadi", "car", "chauffeur", "airport drop", "service centre"], terms: ["driver", "drive", "car", "pickup", "drop"], near: ["delivery"] },
  { id: "tutor", label: "Tutoring", says: ["tutor", "tuition", "teacher", "padhai", "homework", "maths", "math", "science", "english", "coaching", "exam", "class"], terms: ["tutor", "tuition", "teaching", "lessons", "homework", "class"], near: ["writing"] },
  { id: "design", label: "Design", says: ["logo", "design", "designer", "poster", "banner", "flyer", "canva", "photoshop", "illustration", "invitation card", "visiting card"], terms: ["design", "logo", "poster", "graphic", "banner"], near: ["video", "writing"] },
  { id: "video", label: "Video editing", says: ["video", "reel", "reels", "edit", "editing", "youtube", "shorts", "subtitles", "premiere"], terms: ["video", "editing", "edit", "reel", "youtube"], near: ["design", "photo"] },
  { id: "photo", label: "Photography", says: ["photo", "photos", "photographer", "photography", "shoot", "photoshoot", "pre wedding"], terms: ["photographer", "photography", "photo", "shoot"], near: ["video", "event"] },
  { id: "writing", label: "Writing", says: ["write", "writing", "content", "article", "blog", "resume", "cv", "cover letter", "translate", "translation", "proofread", "typing"], terms: ["writing", "content", "resume", "translation", "write"], near: ["dataentry", "design"] },
  { id: "dataentry", label: "Data entry", says: ["data entry", "excel", "spreadsheet", "google sheets", "typing", "copy paste", "pdf to excel"], terms: ["data", "entry", "excel", "spreadsheet", "typing"], near: ["writing"] },
  { id: "beauty", label: "Beauty", says: ["mehndi", "mehendi", "henna", "makeup", "make up", "parlour", "parlor", "facial", "haircut", "salon", "waxing", "threading", "bridal"], terms: ["makeup", "mehndi", "henna", "beauty", "bridal", "salon"], near: ["event", "photo"] },
  { id: "event", label: "Event help", says: ["wedding", "shaadi", "party", "birthday", "decoration", "decor", "event", "function", "catering", "puja", "pooja"], terms: ["event", "party", "decoration", "wedding", "birthday"], near: ["photo", "cook", "beauty"] },
  { id: "pet", label: "Pet care", says: ["pet", "dog", "kutta", "cat", "dog walk", "dog walking", "pet sitting", "grooming"], terms: ["pet", "dog", "walking", "sitting", "grooming"], near: ["errands"] },
  { id: "tailor", label: "Tailoring", says: ["tailor", "darzi", "stitch", "stitching", "alteration", "blouse", "kurta", "hem"], terms: ["tailor", "stitching", "alteration"], near: ["beauty"] },
  { id: "garden", label: "Gardening", says: ["garden", "gardener", "mali", "plants", "lawn", "grass", "pots", "terrace garden"], terms: ["garden", "gardening", "plants", "lawn"], near: ["cleaning"] },
  { id: "care", label: "Care at home", says: ["nurse", "caretaker", "attendant", "elderly", "old age", "babysitter", "nanny", "aaya", "patient care"], terms: ["care", "caretaker", "nurse", "elderly", "babysitting"], near: ["cook", "cleaning"] },
  { id: "fitness", label: "Fitness", says: ["yoga", "gym", "trainer", "fitness", "workout", "zumba", "personal trainer"], terms: ["yoga", "fitness", "trainer", "workout"], near: ["tutor"] },
];

const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

/**
 * Words that say nothing about the kind of work. Left out of the word search so "fix my tap" is about the tap, not
 * every post that says "fix". Kept when they are all there is.
 */
const FILLER = new Set([
  "a", "an", "the", "my", "me", "i", "im", "we", "our", "your", "you", "is", "are", "am", "be", "to", "for", "of", "in", "on",
  "at", "and", "or", "with", "from", "it", "this", "that", "some", "someone", "somebody", "anyone", "need", "needed", "needs",
  "want", "wanted", "looking", "help", "please", "pls", "plz", "urgent", "urgently", "today", "now", "asap", "get", "got",
  "do", "done", "doing", "can", "could", "who", "will", "would", "should", "near", "nearby", "home", "house", "fix", "fixed",
  "repair", "repairs", "work", "job", "jobs", "task", "tasks", "kaam", "ka", "ki", "ke", "ko", "hai", "nahi", "nahin", "kar",
  "raha", "rahi", "karna", "karo", "chahiye", "mera", "meri", "mujhe", "koi", "bhi", "aur", "se", "very", "not", "good",
]);

/** Every word the understanding knows, for spelling fixes. */
const VOCAB: string[] = [...new Set(CONCEPTS.flatMap((c) => [...c.says, ...c.terms]).flatMap((p) => p.split(/\s+/)).filter((w) => w.length >= 4))];
const KNOWN = new Set([...VOCAB, ...FILLER]);

export function normalize(q: string): string {
  return q.toLowerCase().replace(/a\/c/g, "ac").replace(/[^a-z0-9\s-]/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

/** Edit distance, stopping early once it passes `max`. */
export function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** "plumbr" -> "plumber". Only unknown words of 5+ letters, to the closest known word (1 slip, or 2 for 8+ letters). */
export function fixWord(w: string): string {
  if (w.length < 5 || KNOWN.has(w) || /\d/.test(w)) return w;
  const max = w.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  for (const v of VOCAB) {
    const d = distance(w, v, max);
    if (d < bestD) {
      best = v;
      bestD = d;
    }
  }
  return best ?? w;
}

export type Understanding = {
  /** What was typed, cleaned. */
  query: string;
  /** The query with spelling fixed, or null when nothing was fixed. */
  corrected: string | null;
  /** The searcher's own words that say something (no filler), spelling fixed. */
  words: string[];
  /** The words the matched kinds of work stand for. */
  expanded: string[];
  /** The kinds of work understood, as chips. */
  chips: { id: string; label: string }[];
  /** The text the meaning fingerprint is made from. */
  embedText: string;
};

const hasPhrase = (padded: string, phrase: string) => padded.includes(` ${phrase} `);

/**
 * Read a search. `drop` removes chips the searcher took off; `exact` keeps their spelling as typed.
 */
export function understand(raw: string, opts: { drop?: readonly string[]; exact?: boolean } = {}): Understanding {
  const query = normalize(raw).slice(0, 200);
  const typed = query ? query.split(" ") : [];
  const fixed = opts.exact ? typed : typed.map(fixWord);
  const corrected = !opts.exact && fixed.join(" ") !== typed.join(" ") ? fixed.join(" ") : null;
  const text = fixed.join(" ");
  const padded = ` ${text} `;
  const drop = new Set(opts.drop ?? []);

  const matched: Concept[] = [];
  for (const c of CONCEPTS) {
    if (drop.has(c.id)) continue;
    // Plural and "-ing" forms count: "pipes", "leaking".
    if (c.says.some((s) => hasPhrase(padded, s) || (!s.includes(" ") && fixed.some((w) => w === `${s}s` || w === `${s}ing`)))) matched.push(c);
  }
  // A kind of work met only through a vague word ("fix", "drop") gives way to one met through a specific word.
  const specific = matched.filter((c) => c.says.some((s) => hasPhrase(padded, s) && !FILLER.has(s)));
  const chosen = (specific.length ? specific : matched).slice(0, 3);

  const meaningful = fixed.filter((w) => !FILLER.has(w) && w.length >= 2);
  const words = meaningful.length ? meaningful : fixed.filter((w) => w.length >= 2);
  const expanded = [...new Set(chosen.flatMap((c) => c.terms))].filter((t) => !words.includes(t));
  const embedText = [text, ...chosen.map((c) => c.label.toLowerCase()), ...expanded.slice(0, 8)].join(" ").trim();
  return { query, corrected, words, expanded, chips: chosen.map((c) => ({ id: c.id, label: c.label })), embedText };
}

/** Kinds of work a partly typed search points to, for "Looks like you mean". */
export function suggestConcepts(raw: string, max = 3): Concept[] {
  const q = normalize(raw);
  if (q.length < 2) return [];
  const u = understand(q);
  const out = u.chips.map((c) => BY_ID.get(c.id)!).filter(Boolean);
  // Still typing: the last word may be the start of one ("plum" -> Plumbing).
  const last = q.split(" ").pop() ?? "";
  if (last.length >= 3) {
    for (const c of CONCEPTS) {
      if (out.length >= max) break;
      if (!out.includes(c) && (c.label.toLowerCase().startsWith(last) || c.says.some((s) => s.startsWith(last)))) out.push(c);
    }
  }
  return out.slice(0, max);
}

/** Close kinds of work to offer when a search finds nothing. */
export function nearConcepts(chips: readonly { id: string }[], max = 2): Concept[] {
  const have = new Set(chips.map((c) => c.id));
  const out: Concept[] = [];
  for (const c of chips) {
    for (const id of BY_ID.get(c.id)?.near ?? []) {
      const n = BY_ID.get(id);
      if (n && !have.has(id) && !out.includes(n)) out.push(n);
    }
  }
  return out.slice(0, max);
}

export function conceptById(id: string): Concept | undefined {
  return BY_ID.get(id);
}

const wordIn = (text: string, w: string) => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9 ]/g, "")}(s|es|ing|ed)?([^a-z0-9]|$)`).test(text);

/** The short grey line on a result card: why it came up. */
export function whyLine(row: { title?: unknown; description?: unknown; category?: unknown }, u: Understanding): string | null {
  if (!u.query) return null;
  const text = normalize(`${row.title ?? ""} ${row.category ?? ""} ${row.description ?? ""}`);
  const own = u.words.filter((w) => wordIn(text, w));
  const same = u.expanded.filter((w) => wordIn(text, w));
  if (same.length) return `Same need: ${same.slice(0, 2).join(", ")}`;
  if (own.length) return `Has your words: ${own.slice(0, 2).join(", ")}`;
  if (u.chips.length) return `Related: ${u.chips[0].label.toLowerCase()}`;
  return "Close in meaning to your search";
}

// ---- meaning fingerprints (gte-small, built into Supabase Edge Functions) ----

export type Embed = (text: string) => Promise<number[] | null>;

type AiSession = { run: (input: string, opts: { mean_pool: boolean; normalize: boolean }) => Promise<unknown> };
let session: AiSession | null | undefined;
let override: Embed | null = null;

/** Tests swap the model for a stand-in. */
export function setEmbedder(e: Embed | null) {
  override = e;
}

function aiSession(): AiSession | null {
  if (session !== undefined) return session;
  // deno-lint-ignore no-explicit-any -- Supabase.ai is a global of the Edge Runtime, absent in tests and Node.
  const ai = (globalThis as any).Supabase?.ai;
  session = ai?.Session ? (new ai.Session("gte-small") as AiSession) : null;
  return session;
}

const cache = new Map<string, number[]>();
const CACHE_MAX = 300;

/** A fingerprint of `text`, or null when the model is missing, fails, or takes longer than `ms`. */
export async function embed(text: string, ms = 1500): Promise<number[] | null> {
  const key = text.slice(0, 500);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) return hit;
  const run = override ? override(key) : (async () => {
    const s = aiSession();
    if (!s) return null;
    const out = await s.run(key, { mean_pool: true, normalize: true });
    return Array.isArray(out) && out.length === 384 ? (out as number[]) : null;
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    const v = await Promise.race([run.catch(() => null), late]);
    if (v) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, v);
    }
    return v;
  } finally {
    clearTimeout(timer);
  }
}

/** The text a post's fingerprint is made from (title, category, description). */
export const postText = (p: { title?: string | null; category?: string | null; description?: string | null }) =>
  [p.title, p.category, p.description].filter(Boolean).join(". ").slice(0, 1500);

export const vectorText = (v: number[]) => `[${v.map((x) => Number(x.toFixed(6))).join(",")}]`;

// ---- the ranked read ----

/** What the api's search reads pass in; `box` narrows to an area before ranking. */
export type RankArgs = {
  kind: "request" | "service";
  text: string;
  drop?: string[];
  exact?: boolean;
  viewer?: string | null;
  pillar?: string | null;
  minMinor?: number | null;
  maxMinor?: number | null;
  box?: { minLat: number; maxLat: number; minLng: number | null; maxLng: number | null } | null;
  limit: number;
};

type RpcDb = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  from(table: string): unknown;
};

/**
 * Ranked ids for a search, best first, with the understanding behind them. Null when the database does not have
 * search_posts yet (migration 223 not applied): the caller then searches the old way.
 */
export async function rankedSearch(db: RpcDb, a: RankArgs): Promise<{ ids: { id: string; score: number }[]; u: Understanding } | null> {
  const u = understand(a.text, { drop: a.drop, exact: a.exact });
  const vector = await embed(u.embedText);
  const res = await db.rpc("search_posts", {
    p_kind: a.kind,
    p_words: u.words,
    p_expanded: u.expanded,
    p_raw: u.corrected ?? u.query,
    p_embedding: vector ? vectorText(vector) : null,
    p_viewer: a.viewer ?? null,
    p_pillar: a.pillar ?? null,
    p_min_minor: a.minMinor ?? null,
    p_max_minor: a.maxMinor ?? null,
    p_min_lat: a.box?.minLat ?? null,
    p_max_lat: a.box?.maxLat ?? null,
    p_min_lng: a.box?.minLng ?? null,
    p_max_lng: a.box?.maxLng ?? null,
    p_limit: a.limit,
  });
  if (res.error?.code === "PGRST202" || res.error?.code === "42883") return null;
  if (res.error) throw new Error(res.error.message ?? "search failed");
  const list = (Array.isArray(res.data) ? res.data : []) as { id: string; score: number }[];
  return { ids: list.filter((r) => typeof r?.id === "string").map((r) => ({ id: r.id, score: Number(r.score) || 0 })), u };
}

/**
 * Make fingerprints for up to `n` open posts that have none (or an old one). Runs after a post is made and after
 * searches, in the background, with the service role; a failure only means it is tried again next time.
 */
export async function fillEmbeddings(admin: RpcDb, n = 4): Promise<number> {
  const res = await admin.rpc("posts_needing_embedding", { p_limit: n });
  if (res.error) return 0;
  let made = 0;
  for (const p of (res.data ?? []) as { id: string; title: string; category: string | null; description: string | null; source_hash: string }[]) {
    const v = await embed(postText(p), 5000);
    if (!v) break;
    // deno-lint-ignore no-explicit-any -- the query builder's type is wider than this one write needs.
    const up = await (admin.from("task_embeddings") as any).upsert({ task_id: p.id, embedding: vectorText(v), source_hash: p.source_hash, made_at: new Date().toISOString() });
    if (!up?.error) made++;
  }
  return made;
}
