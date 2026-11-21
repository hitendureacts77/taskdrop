/**
 * One call at a time. Saving a session removes the old copy and writes the new one in pieces, and
 * supabase-js saves on every token renewal while the app is also reading. A read that landed
 * between those steps saw a half-written session, took it as signed out, and the person was sent
 * to the sign-in page in the middle of a task (round 7, P1-9). Queued, a read always sees the whole
 * old session or the whole new one.
 */
export function inOrder() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    // The next call waits for this one, whether it worked or not.
    tail = run.catch(() => undefined);
    return run;
  };
}
