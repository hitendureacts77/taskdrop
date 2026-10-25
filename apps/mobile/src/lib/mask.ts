/**
 * Contact details stay inside TaskDrop until someone is hired: a quote or a
 * proposal that carries a phone number, an email or a chat handle lets both
 * sides take the job off the platform, and with it the escrow that protects
 * them. So those are hidden as they are typed, not rejected after the fact.
 */

const HIDDEN = '•••';

// Digits written another way still make a phone number: Devanagari, Arabic-Indic or full-width digits,
// keycap emoji (9️⃣), or eight or more spelled-out digits in a row ("nine eight seven six ...").
// Found 2026-10-24 by the break-it test: all three got a phone number past the rule.
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];
const DIGIT_WORDS: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

export function normalizeDigits(text: string): string {
  return text
    .replace(/(\d)️?⃣/g, '$1')
    .replace(/\p{Nd}/gu, (d) => {
      const cp = d.codePointAt(0) ?? 0;
      const start = DIGIT_BLOCKS.filter((b) => b <= cp).pop();
      return start === undefined || cp - start > 9 ? d : String(cp - start);
    })
    .replace(/\b(?:(?:zero|one|two|three|four|five|six|seven|eight|nine)\b[\s,.-]*){8,}/gi, (run) =>
      (run.match(/zero|one|two|three|four|five|six|seven|eight|nine/gi) ?? []).map((w) => DIGIT_WORDS[w.toLowerCase()]).join(' '),
    );
}

export const PATTERNS: RegExp[] = [
  // Emails.
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  // Links and chat deep-links (wa.me, t.me, instagram.com/...).
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b(?:wa\.me|t\.me|instagram\.com|facebook\.com|fb\.me|telegram\.me)\/\S*/gi,
  // Phone numbers: 8+ digits, allowing spaces, dashes, dots, brackets and a
  // leading +country code -- "+91 98765 43210", "98765-43210", "(080) 2345 6789".
  /(?:\+?\d[\s\-.()]*){8,}\d/g,
  // Social handles written out: "@ravi_fixes", "insta: ravi", "whatsapp me on".
  /(?:^|\s)@[A-Za-z0-9_.]{3,}/g,
  /\b(?:whats\s?app|insta(?:gram)?|telegram|snap(?:chat)?|call me on|ping me on)\b\s*[:\-]?\s*\S*/gi,
];

export function maskContacts(text: string): { text: string; masked: boolean } {
  // Digits in another script or spelled out are read as digits when they make a phone number.
  const plain = normalizeDigits(text);
  let out = plain !== text && /(?:\+?\d[\s\-.()]*){8,}\d/.test(plain) ? plain : text;
  let masked = false;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => {
      masked = true;
      // Keep the leading space a handle pattern swallowed, so words don't run together.
      return (/^\s/.test(m) ? ' ' : '') + HIDDEN;
    });
  }
  return { text: out, masked };
}

// A door-level address: flat/house/plot/door numbers, "12/3 5th cross",
// "#45, 2nd main", a six-digit PIN code, or "my address is".
export const ADDRESS: RegExp[] = [
  /\b(?:flat|house|h\s?\.?\s?no|door|plot|apartment|apt|block|shop)\s*(?:no\.?|number|#)?\s*[:#\-.]?\s*\d+[a-z]?\b/i,
  /#\s?\d+[a-z]?\s*,/i,
  /\b\d+\s*(?:st|nd|rd|th)?\s+(?:cross|main|street|lane|road|block|sector|phase)\b/i,
  /\b\d{1,4}\s*[/\-]\s*\d{1,4}\b[^.\n]{0,40}\b(?:street|st|road|rd|lane|cross|main|nagar|colony|layout|society)\b/i,
  // A PIN code, but not an amount: "₹200000", "Rs 250000", "150000 rupees".
  /(?<![₹\d,.]\s?|\brs\.?\s?|\binr\s?)\b[1-9]\d{2}\s?\d{3}\b(?![\s\-.]*\d)(?!\s*(?:rs\b|rupees|inr\b|\/-))/i,
  /\bmy\s+(?:home\s+)?address\s+is\b/i,
];

export type ContactIssue = 'phone' | 'email' | 'link' | 'handle' | 'address';

/**
 * What kind of contact detail a post contains, if any. Posts are public, so
 * unlike quotes (where details are hidden as typed) a post that carries one
 * is stopped before it can go out, with the reason.
 */
export function findContactIssue(text: string): ContactIssue | null {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return 'email';
  if (/(?:\+?\d[\s\-.()]*){8,}\d/.test(normalizeDigits(text))) return 'phone';
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(text) || /\b(?:wa\.me|t\.me|instagram\.com|facebook\.com|fb\.me|telegram\.me)\//i.test(text)) return 'link';
  if (/(?:^|\s)@[A-Za-z0-9_.]{3,}/.test(text) || /\b(?:whats\s?app|telegram|snapchat|call me on|ping me on)\b/i.test(text)) return 'handle';
  if (ADDRESS.some((re) => re.test(text))) return 'address';
  return null;
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
    case 'link':
      return 'Links aren’t allowed on your profile. Share them in chat once a task is booked.';
    case 'handle':
      return 'Social handles and chat apps aren’t allowed on your profile. Use TaskDrop chat instead.';
    case 'address':
      return 'Don’t share your address here. Your area is enough — the exact spot is only shared for a booked task.';
  }
}

/**
 * Names and usernames are shown to strangers, so they must not smuggle a
 * number out either: "@9876543210" is a phone number with an @ in front.
 */
export function nameCarriesContact(name: string): boolean {
  return /\d{7,}/.test(normalizeDigits(name).replace(/[\s\-.]/g, '')) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(name);
}

export function contactIssueMessage(issue: ContactIssue): string {
  switch (issue) {
    case 'phone':
      return 'Remove the phone number. You can share it in chat after you hire someone.';
    case 'email':
      return 'Remove the email address. You can share it in chat after you hire someone.';
    case 'link':
      return 'Remove the link. Share it in chat once you’ve hired someone.';
    case 'handle':
      return 'Remove the chat handle or app name. You’ll talk in TaskDrop chat once you hire.';
    case 'address':
      return 'Remove the house, flat or street number. Just the area is fine — you set the exact spot later, and only the person you hire sees it.';
  }
}
