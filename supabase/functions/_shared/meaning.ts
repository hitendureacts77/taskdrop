/**
 * Turns a short text into a "meaning" vector with the Edge runtime's built-in model (gte-small, 384 numbers),
 * so "teaching maths" can be matched to "Tutoring". No network call and no key. Best-effort: where the model
 * is missing (tests, an old runtime), it fails, or it is slow, the answer is null and callers match by spelling only.
 *
 * No Deno imports on purpose, so this can be tested from Node.
 */

type Session = { run(input: string, opts: { mean_pool: boolean; normalize: boolean }): Promise<unknown> };

let session: Session | null = null;

function getSession(): Session | null {
  if (session) return session;
  // deno-lint-ignore no-explicit-any
  const ai = (globalThis as any).Supabase?.ai;
  if (!ai || typeof ai.Session !== "function") return null;
  session = new ai.Session("gte-small") as Session;
  return session;
}

/** Forget the cached model session (tests only). */
export function resetMeaningSession(): void {
  session = null;
}

/** The meaning vector of `text`, or null when it cannot be had within `timeoutMs`. Never throws. */
export async function embedText(text: string, timeoutMs = 800): Promise<number[] | null> {
  try {
    const s = getSession();
    if (!s) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    try {
      const out = await Promise.race([s.run(text, { mean_pool: true, normalize: true }), timeout]);
      if (out == null) return null;
      const arr = Array.from(out as ArrayLike<number>);
      return arr.length > 0 && arr.every((n) => typeof n === "number" && Number.isFinite(n)) ? arr : null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** The pgvector text form: `[0.1,0.2,...]`, six decimals. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((n) => n.toFixed(6)).join(",")}]`;
}
