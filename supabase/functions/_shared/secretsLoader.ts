/**
 * The single-flight loader behind `secret()` in secrets.ts (plan task 3.5b, hole H70).
 *
 * The bug it replaces: the old code set a "loaded" flag BEFORE the Vault read finished, so a second request that
 * arrived while a new server copy was still loading skipped the load and read an empty cache. Here every caller
 * awaits the same in-flight promise, and a failed load is forgotten so the next call tries again.
 *
 * No Deno imports on purpose, so it can be exercised from Node. It never logs or returns anything but the values.
 */

/** One read of every Vault secret. Resolves to the name/value pairs, or rejects when the read failed. */
export type VaultFetch = () => Promise<Record<string, string>>;

export type VaultLoader = {
  /** The Vault secrets, loaded at most once at a time. Never rejects: a failed load gives {} and is retried later. */
  load: () => Promise<ReadonlyMap<string, string>>;
};

export function makeVaultLoader(fetchAll: VaultFetch): VaultLoader {
  let inFlight: Promise<ReadonlyMap<string, string>> | null = null;

  const run = (): Promise<ReadonlyMap<string, string>> => {
    const p = (async () => {
      const data = await fetchAll();
      const loaded = new Map<string, string>();
      for (const [name, value] of Object.entries(data ?? {})) {
        if (value) loaded.set(name, value);
      }
      return loaded;
    })();
    // A failed load must not be kept: forget it so a later call retries. Callers already waiting get the empty map.
    const settled: Promise<ReadonlyMap<string, string>> = p.catch(() => {
      if (inFlight === settled) inFlight = null;
      return new Map<string, string>();
    });
    return settled;
  };

  return {
    load() {
      if (!inFlight) inFlight = run();
      return inFlight;
    },
  };
}
