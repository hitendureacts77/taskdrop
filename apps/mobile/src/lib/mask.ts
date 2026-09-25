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
