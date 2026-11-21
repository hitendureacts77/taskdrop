/**
 * Contact details stay inside TaskDrop until someone is hired: a quote or a
 * proposal that carries a phone number, an email or a chat handle lets both
 * sides take the job off the platform, and with it the escrow that protects
 * them. So those are hidden as they are typed, not rejected after the fact.
 */

// ==== ONE CONTACT RULE (everything from this line to the end of the file) ====
// This part is the same, character for character, here (apps/mobile/src/lib/mask.ts) and in the api's
// supabase/functions/_shared/contacts.ts: contacts.test.ts fails if they differ. The database follows the
// same rule in private.contact_issue (migration 184); contactCases.ts is the one table of texts that must be
// refused or allowed, and it is checked against the app, the api and the database (supabase/tests/contact_rule.test.sql).

const HIDDEN = '•••';

// Characters nobody sees, which split a number or an email without showing: zero-width spaces and joiners,
// direction marks, the soft hyphen, the word joiner, the byte-order mark, invisible fillers, variation
// selectors and the keycap mark (9️⃣ is "9" + U+FE0F + U+20E3). Round 8 (S1-3): "9​8​7..." with U+200B passed.
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁪-⁯⃣ㅤ︀-️﻿ﾠ]/g;

// Spaces, written out so that the app, the server and the database (whose \s differs) read the same ones.
const SP = ' \\t\\n\\r\\f\\v\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';

// Digits written another way: [first code point, last code point, the digit the first one stands for].
// Other scripts (Arabic-Indic, Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada,
// Malayalam, Sinhala, Thai, Lao, Tibetan, Myanmar, Khmer, Mongolian, NKo, full-width), mathematical bold and
// other styled digits (𝟗), superscript and subscript digits, and circled or bracketed ones (⑨ ❾ ⑼ ⒐).
export const DIGIT_RANGES: [number, number, number][] = [
  [0x0660, 0x0669, 0], [0x06f0, 0x06f9, 0], [0x07c0, 0x07c9, 0], [0x0966, 0x096f, 0], [0x09e6, 0x09ef, 0],
  [0x0a66, 0x0a6f, 0], [0x0ae6, 0x0aef, 0], [0x0b66, 0x0b6f, 0], [0x0be6, 0x0bef, 0], [0x0c66, 0x0c6f, 0],
  [0x0ce6, 0x0cef, 0], [0x0d66, 0x0d6f, 0], [0x0de6, 0x0def, 0], [0x0e50, 0x0e59, 0], [0x0ed0, 0x0ed9, 0],
  [0x0f20, 0x0f29, 0], [0x1040, 0x1049, 0], [0x1090, 0x1099, 0], [0x17e0, 0x17e9, 0], [0x1810, 0x1819, 0],
  [0xff10, 0xff19, 0], [0x1d7ce, 0x1d7ff, 0], [0x2080, 0x2089, 0], [0x2070, 0x2070, 0], [0x00b9, 0x00b9, 1],
  [0x00b2, 0x00b3, 2], [0x2074, 0x2079, 4], [0x2460, 0x2468, 1], [0x24ea, 0x24ea, 0], [0x2474, 0x247c, 1],
  [0x2488, 0x2490, 1], [0x24f5, 0x24fd, 1], [0x24ff, 0x24ff, 0], [0x2776, 0x277e, 1], [0x2780, 0x2788, 1],
  [0x278a, 0x2792, 1],
];

const DIGIT_WORDS: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

/** The text as the rule reads it: invisible characters gone and every digit, however it is written, a 0-9 digit. */
export function cleanText(text: string): string {
  let out = '';
  for (const ch of text.replace(INVISIBLE, '')) {
    const cp = ch.codePointAt(0) ?? 0;
    const r = cp < 0xb2 ? undefined : DIGIT_RANGES.find(([a, b]) => cp >= a && cp <= b);
    out += r ? String((r[2] + cp - r[0]) % 10) : ch;
  }
  return out;
}

/** cleanText, and spelled-out digits as digits too ("nine eight seven ..."), for the phone number check only. */
export function normalizeDigits(text: string): string {
  return cleanText(text).replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/gi, (w) => DIGIT_WORDS[w.toLowerCase()] ?? w);
}

// A run of digits joined the ways people split a number: spaces, dashes, dots, commas, slashes, underscores
// and brackets, up to three of them between two digits ("98765/43210", "98765_43210", "+91 (98765) 43210").
export const DIGIT_RUN = new RegExp(`\\+?[0-9](?:[${SP}\\-–—.,/_()]{0,3}[0-9])*`, 'g');

/**
 * Whether one run of digits is a phone number (S3-30: not every long number is one).
 *  - A date in front ("12.03.2026 18") is not part of it.
 *  - With a + it is one from 8 digits ("+44 20 7946 0958").
 *  - Starting with 0 it is one from 8 digits (a landline with its code, "040 2345678").
 *  - Otherwise it is one from 10 digits (a mobile, "98765 43210", or longer: account and ID numbers too),
 *    unless it is two or more round amounts in a row or a range ("10000 - 20000", "1,500, 2,000, 3,000").
 * Shorter numbers ("5000-10000", "order 123456789") are left alone.
 */
export function isPhoneRun(run: string): boolean {
  const rest = run.replace(/^(?:0?[1-9]|[12][0-9]|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)[0-9]{2}(?![0-9])/, '');
  const digits = rest.replace(/[^0-9]/g, '');
  if (run.startsWith('+')) return digits.length >= 8;
  if (digits.length >= 8 && digits.startsWith('0')) return true;
  if (digits.length < 10) return false;
  const parts = rest.split(new RegExp(`,[${SP}]+|[${SP}]*[-–—][${SP}]*`));
  const amounts = parts.length >= 2 && parts.every((p) => /^[0-9]{3,}$/.test(p.replace(/[^0-9]/g, '')) && /00$/.test(p.replace(/[^0-9]/g, '')));
  return !amounts;
}

function hasPhone(text: string): boolean {
  for (const m of normalizeDigits(text).matchAll(DIGIT_RUN)) if (isPhoneRun(m[0])) return true;
  return false;
}

// Mail and UPI providers people name when they spell an address out.
const MAIL_HOSTS = 'gmail|googlemail|yahoo|ymail|hotmail|outlook|live|rediffmail|rediff|icloud|protonmail|proton|zoho';
const UPI_HANDLES = 'ok[a-z]+|ybl|ibl|axl|apl|yapl|paytm|pt[a-z]+|upi|icici|sbi|hdfcbank|axisbank|kotak|airtel|jio|fbl|freecharge|abfspay|wa[a-z]+|axisb|idfcbank|federal|indus|rbl|barodampay|unionbank|pnb|boi|cnrb|kbl|aubank|dbs|hsbc|sc|citi';
const TLDS = 'com|in|net|org|io|me|co|app|link|ly|ee|be|gl|gg|site|online|xyz|info|biz|store|shop|dev|page|to|tv|ai|us|uk|bio|li|cc|ws';
const CHAT_APPS = 'whats\\s?app|watsapp|whatsap|insta(?:gram)?|telegram|snapchat|facebook|messenger';
// Words that follow an app's name in ordinary work talk ("manage my Instagram page"), so they are not a handle.
const APP_WORDS =
  'page|pages|account|accounts|reel|reels|post|posts|story|stories|ad|ads|marketing|profile|profiles|content|follower|followers|growth|business|shop|store|video|videos|photo|photos|pic|pics|filter|filters|live|influencer|influencers|bio|theme|grid|highlight|highlights|caption|captions|group|groups|channel|channels|status|chat|chats|call|calls|web|app|apps|api|bot|bots|login|verification|verified|handle|link|links|tick|ban|banned|hacked|help|support|expert|work|job|jobs|task|tasks|service|services|setup|management|manager|and|or|for|to|the|a|an|of|with|from|in|on|at|by|it|this|that|also|too|not|only';

/** Each kind of contact detail, and how it is found (case does not matter). */
export const CONTACT_RULES: { kind: ContactIssue; re: RegExp }[] = [
  // Emails: "ravi.k@example.com", "ravi @ gmail . com", "ravi (at) gmail (dot) com", "ravi at gmail".
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi },
  { kind: 'email', re: new RegExp(`[A-Z0-9._%+-]+[${SP}]*@[${SP}]*[A-Z0-9-]+(?:[${SP}]*\\.[${SP}]*[A-Z0-9-]+)*[${SP}]*\\.[${SP}]*(?:com|in|net|org|co|io|me|info|biz|edu|gov|ac|ai|app|dev|xyz|us|uk)\\b`, 'gi') },
  { kind: 'email', re: new RegExp(`[A-Z0-9_.+-]+[${SP}]*[(\\[{<][${SP}]*at[${SP}]*[)\\]}>][${SP}]*[A-Z0-9_-]+(?:[${SP}]*(?:[(\\[{<][${SP}]*dot[${SP}]*[)\\]}>]|\\.)[${SP}]*[A-Z0-9_-]+)*`, 'gi') },
  { kind: 'email', re: new RegExp(`\\b[A-Z0-9_.+-]+[${SP}]+at[${SP}]+(?:[A-Z0-9_-]+[${SP}]+dot[${SP}]+[A-Z]{2,}\\b|(?:${MAIL_HOSTS})\\b)`, 'gi') },
  // UPI ids are payment handles (S1-4): "ravi@okaxis", "9876@ybl", "ravi @ ybl", "my upi is ravi_k".
  { kind: 'upi', re: /[A-Z0-9._-]{2,}@[A-Z][A-Z0-9]+/gi },
  { kind: 'upi', re: new RegExp(`[A-Z0-9._-]{2,}[${SP}]*@[${SP}]*(?:${UPI_HANDLES})\\b`, 'gi') },
  { kind: 'upi', re: new RegExp(`\\bupi(?:[${SP}]*(?:id|handle|address|no\\.?|number))?[${SP}]*(?:is|:|-|=)[${SP}]*[A-Z0-9._-]*[@0-9_.][A-Z0-9._@-]*`, 'gi') },
  // Links, with or without http or www: "www.example.com", "ravifixes.in", "bit.ly/ravi", "wa.me/91...".
  { kind: 'link', re: new RegExp(`\\b(?:https?://|www\\.)[^${SP}]+`, 'gi') },
  { kind: 'link', re: new RegExp(`\\b[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*(?:\\.[A-Za-z0-9-]+)*\\.(?:${TLDS})\\b(?:/[^${SP}]*)?`, 'g') },
  // Handles and chat apps (S1-6, S6-39): "@ravi_fixes", "DM me on insta", "insta: ravi", "telegram ravi99",
  // "whatsapp me", "insta ravi"; but "manage my Instagram page" and "meet @5pm" are left alone.
  { kind: 'handle', re: /(?<![A-Z0-9_@.])@(?![0-9]{1,2}(?::[0-9]{2})?[ ]?(?:am|pm)\b)[A-Z0-9_.]{3,}/gi },
  { kind: 'handle', re: new RegExp(`\\b(?:${CHAT_APPS})(?:[${SP}]+(?:id|handle|username|user[${SP}]?name|no\\.?|number|account|acc|profile))*[${SP}]*(?:[:=@]|-[${SP}]|[${SP}]is\\b)[${SP}]*@?(?!(?:${APP_WORDS})\\b)[A-Z0-9._]{2,}`, 'gi') },
  { kind: 'handle', re: new RegExp(`\\b(?:${CHAT_APPS})[${SP}]+(?:me|us)\\b`, 'gi') },
  { kind: 'handle', re: new RegExp(`\\b(?:${CHAT_APPS})[${SP}]+@?(?=[A-Z0-9._]*[A-Z])[A-Z0-9._]*[0-9_.][A-Z0-9._]*[A-Z0-9_]`, 'gi') },
  { kind: 'handle', re: new RegExp(`\\b(?:insta|snap|tg)[${SP}]+(?!(?:${APP_WORDS})\\b)[A-Z]{2,}[${SP}]*(?:$|[,.!;?\\n])`, 'gi') },
  // Last, so a handle after the app's name is hidden with it ("add me on snapchat: ravi_fixes").
  { kind: 'handle', re: new RegExp(`\\b(?:dm|message|msg|text|ping|call|contact|reach|find|follow|add|hmu)[${SP}]+(?:(?:me|us)[${SP}]+)?(?:on|at|via|in|through)[${SP}]+(?:${CHAT_APPS}|fb|ig|wa|snap)\\b`, 'gi') },
];

// A door-level address (S6-40: only that, not "Door 2 door delivery" or "shop 5 min away"): flat, house,
// plot or door numbers, "#45, 2nd main", "12/3 5th cross", or "my address is". A PIN code is an area, not a
// door, so it is allowed (S3-31, S6-40: "I can pay 150000", "I am in Madhapur 500081").
const UNITS = 'min|mins|minute|minutes|hr|hrs|hour|hours|km|kms|day|days|week|weeks|month|months|year|years|time|times|people|person|persons|item|items|pcs|kg|kgs|bhk|floor|floors|door|doors|feet|ft|sq|am|pm|x';
export const ADDRESS: RegExp[] = [
  new RegExp(`\\b(?:flat|h\\.?[${SP}]?no|plot|apartment|apt)[${SP}]*(?:no\\.?|number|#)?[${SP}]*[:#.-]?[${SP}]*[0-9]+[a-z]?\\b(?![${SP}]*(?:${UNITS})\\b)`, 'i'),
  // House, door, block and shop are everyday words ("paint my house 2 coats", "door 2 door"): only with a
  // number sign ("House no 12", "Shop #4") or a number that ends the part ("House 12, Green Park").
  new RegExp(`\\b(?:house|door|block|shop)[${SP}]*(?:(?:no\\.?|number|#)[${SP}]*[:.-]?|[:#-])[${SP}]*[0-9]+[a-z]?\\b`, 'i'),
  new RegExp(`\\b(?:house|door|block|shop)[${SP}]+[0-9]+[a-z]?[${SP}]*(?:,|$)`, 'i'),
  new RegExp(`#[${SP}]?[0-9]+[a-z]?[${SP}]*,[^.\\n]{0,40}\\b(?:main|cross|road|rd|street|st|lane|floor|nagar|colony|layout|block|apartments?|residency|towers?|society|enclave|phase|sector|stage)\\b`, 'i'),
  // "5th cross", "12 main": a street. ("4th Block", "Sector 62", "Phase 2" are areas, so they stay.)
  new RegExp(`\\b[0-9]+[${SP}]*(?:st|nd|rd|th)?[${SP}]+(?:cross|main|street|lane|road)\\b`, 'i'),
  new RegExp(`\\b[0-9]{1,4}[${SP}]*[/-][${SP}]*[0-9]{1,4}\\b[^.\\n]{0,40}\\b(?:street|st|road|rd|lane|cross|main|nagar|colony|layout|society)\\b`, 'i'),
  new RegExp(`\\bmy[${SP}]+(?:home[${SP}]+)?address[${SP}]+is\\b`, 'i'),
];

export type ContactIssue = 'phone' | 'email' | 'upi' | 'link' | 'handle' | 'address';

/**
 * What kind of contact detail a text contains, if any: emails, UPI ids, phone numbers, links, handles, then
 * door-level addresses. Posts are public, so unlike quotes (where details are hidden as typed) a post that
 * carries one is stopped before it can go out, with the reason.
 */
export function findContactIssue(text: string): ContactIssue | null {
  if (!text) return null;
  const clean = cleanText(text);
  for (const kind of ['email', 'upi'] as const) {
    if (CONTACT_RULES.some((r) => r.kind === kind && clean.search(r.re) !== -1)) return kind;
  }
  if (hasPhone(text)) return 'phone';
  for (const kind of ['link', 'handle'] as const) {
    if (CONTACT_RULES.some((r) => r.kind === kind && clean.search(r.re) !== -1)) return kind;
  }
  if (ADDRESS.some((re) => clean.search(re) !== -1)) return 'address';
  return null;
}

/** Quotes, proof and chat: every contact detail (not an address) is replaced by •••, as it is typed. */
export function maskContacts(text: string): { text: string; masked: boolean } {
  if (!text) return { text, masked: false };
  // Digits in another script or spelled out are read as digits when they make a phone number.
  let out = hasPhone(text) ? normalizeDigits(text) : cleanText(text);
  let masked = false;
  const hide = (m: string) => {
    masked = true;
    // Keep a leading space a pattern swallowed, so words don't run together.
    return (/^\s/.test(m) ? ' ' : '') + HIDDEN;
  };
  // Emails and UPI ids first (they can hold digits), then whole phone numbers, then links and handles, so
  // that "my whatsapp number is 98765 43210" hides the whole number, not the first half.
  for (const rule of CONTACT_RULES) if (rule.kind === 'email' || rule.kind === 'upi') out = out.replace(rule.re, hide);
  out = out.replace(DIGIT_RUN, (m) => (isPhoneRun(m) ? hide(m) : m));
  for (const rule of CONTACT_RULES) if (rule.kind !== 'email' && rule.kind !== 'upi') out = out.replace(rule.re, hide);
  return masked ? { text: out, masked } : { text, masked: false };
}

/**
 * Names and usernames are shown to strangers, so they must not smuggle a number out either: "@9876543210"
 * is a phone number with an @ in front, and so is "r98765_43210" (S1-8).
 */
export function nameCarriesContact(name: string): boolean {
  if (!name) return false;
  const clean = cleanText(name);
  return (
    /[0-9]{7,}/.test(normalizeDigits(name).replace(new RegExp(`[${SP}\\-–—.,/_()+]`, 'g'), '')) ||
    CONTACT_RULES.some((r) => (r.kind === 'email' || r.kind === 'upi') && clean.search(r.re) !== -1)
  );
}

/**
 * The same rule for profiles, worded for them. A profile is public to everyone
 * who quotes or is quoted, so it carries basics only; contacts are exchanged
 * inside TaskDrop once a task is locked and under way.
 */
export function profileIssueMessage(issue: ContactIssue): string {
  switch (issue) {
    case 'phone':
      return 'You can’t put a phone number on your profile. It’s shared automatically once a task starts.';
    case 'email':
      return 'You can’t put an email address on your profile. Talk in TaskDrop chat once you’re hired.';
    case 'upi':
      return 'You can’t put a UPI ID on your profile. Payments go through TaskDrop, so the money stays protected.';
    case 'link':
      return 'Links aren’t allowed on your profile. Share them in chat once a task is booked.';
    case 'handle':
      return 'Social handles and chat apps aren’t allowed on your profile. Use TaskDrop chat instead.';
    case 'address':
      return 'Don’t share your address here. Your area is enough — the exact spot is only shared for a booked task.';
  }
}

/** The same rule for an offer's proposal (W2-2), worded for the worker sending it. */
export function offerIssueMessage(issue: ContactIssue): string {
  switch (issue) {
    case 'phone':
      return 'Remove the phone number. It’s shared automatically once you’re hired.';
    case 'email':
      return 'Remove the email address. Talk in TaskDrop chat once you’re hired.';
    case 'upi':
      return 'Remove the UPI ID. You’re paid through TaskDrop once the work is approved.';
    case 'link':
      return 'Remove the link. Share it in chat once you’re hired.';
    case 'handle':
      return 'Remove the chat handle or app name. You’ll talk in TaskDrop chat once you’re hired.';
    case 'address':
      return 'Don’t share your address here. The exact spot is shared once the task is booked.';
  }
}

/** The same rule for text everyone can read (questions, answers, reviews, the Ideas board). */
export function publicIssueMessage(issue: ContactIssue): string {
  switch (issue) {
    case 'phone':
      return 'Leave the phone number out. Everyone can read this, and contacts unlock when the work starts.';
    case 'email':
      return 'Leave the email address out. Everyone can read this, and contacts unlock when the work starts.';
    case 'upi':
      return 'Leave the UPI ID out. Payments go through TaskDrop, so the money stays protected.';
    case 'link':
      return 'Leave the link out. Everyone can read this. Share it in chat once the work starts.';
    case 'handle':
      return 'Leave chat handles and app names out. Everyone can read this. Talk in TaskDrop chat instead.';
    case 'address':
      return 'Leave the house, flat or street number out. Everyone can read this; the area is enough.';
  }
}

export function contactIssueMessage(issue: ContactIssue): string {
  switch (issue) {
    case 'phone':
      return 'Remove the phone number. You can share it in chat after you hire someone.';
    case 'email':
      return 'Remove the email address. You can share it in chat after you hire someone.';
    case 'upi':
      return 'Remove the UPI ID. Payment goes through TaskDrop, so your money stays protected.';
    case 'link':
      return 'Remove the link. Share it in chat once you’ve hired someone.';
    case 'handle':
      return 'Remove the chat handle or app name. You’ll talk in TaskDrop chat once you hire.';
    case 'address':
      return 'Remove the house, flat or street number. Just the area is fine — you set the exact spot later, and only the person you hire sees it.';
  }
}
