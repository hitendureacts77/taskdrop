/**
 * The sign-out question names every way this person can sign back in (W2-16: it always said "phone number or
 * Google account", leaving out a username and password, and naming Google for people without it). Pure, tested
 * in Node (signOutText.test.ts).
 */
export type SignInMethods = { phone: boolean; google: boolean; username: boolean };

export function signOutMessage(m: SignInMethods | null): string {
  const tail = 'Your tasks and wallet stay safe.';
  if (!m) return `You’ll need one of your sign-in methods to sign back in. ${tail}`;
  const ways = [
    m.phone ? 'your phone number' : null,
    m.google ? 'your Google account' : null,
    m.username ? 'your username and password' : null,
  ].filter((x): x is string => x !== null);
  if (ways.length === 0) return `You’ll need one of your sign-in methods to sign back in. ${tail}`;
  const list = ways.length === 1 ? ways[0] : `${ways.slice(0, -1).join(', ')} or ${ways[ways.length - 1]}`;
  return `You’ll need ${list} to sign back in. ${tail}`;
}
