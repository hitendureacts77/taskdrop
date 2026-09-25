/**
 * Contact details stay inside TaskDrop until someone is hired: a quote or a
 * proposal that carries a phone number, an email or a chat handle lets both
 * sides take the job off the platform, and with it the escrow that protects
 * them. So those are hidden as they are typed, not rejected after the fact.
 */

const HIDDEN = '•••';

const PATTERNS: RegExp[] = [
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
  let out = text;
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
const ADDRESS: RegExp[] = [
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
  if (/(?:\+?\d[\s\-.()]*){8,}\d/.test(text)) return 'phone';
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(text) || /\b(?:wa\.me|t\.me|instagram\.com|facebook\.com|fb\.me|telegram\.me)\//i.test(text)) return 'link';
  if (/(?:^|\s)@[A-Za-z0-9_.]{3,}/.test(text) || /\b(?:whats\s?app|telegram|snapchat|call me on|ping me on)\b/i.test(text)) return 'handle';
  if (ADDRESS.some((re) => re.test(text))) return 'address';
  return null;
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
