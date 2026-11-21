/**
 * The one table of texts for the contact rule: what must be refused (and as what) and what must be let
 * through. contacts.test.ts runs it against the app (apps/mobile/src/lib/mask.ts) and the api
 * (_shared/contacts.ts), and checks that supabase/tests/contact_rule.test.sql carries the same rows for the
 * database (private.contact_issue, migration 184). Add a row here when a new trick or a new false alarm
 * is found, then paste the block the test prints into the SQL test.
 *
 * Not a function input: the api never imports this file.
 */
import type { ContactIssue } from "./contacts.ts";

export type ContactCase = { text: string; kind: ContactIssue | null };

export const CONTACT_CASES: ContactCase[] = [
  // ---- phone numbers, however they are split or written (S1-3, S6-39) ----
  { text: "Call me on 98765 43210", kind: "phone" },
  { text: "+91 98765 43210", kind: "phone" },
  { text: "(080) 2345 6789", kind: "phone" },
  { text: "landline 040 2345678", kind: "phone" },
  { text: "98765-43210", kind: "phone" },
  { text: "98765/43210", kind: "phone" },
  { text: "98765,43210", kind: "phone" },
  { text: "98765_43210", kind: "phone" },
  { text: "9​8​7​6​5​4​3​2​1​0", kind: "phone" },
  { text: "98765⁠43210", kind: "phone" },
  { text: "\u{1d7d7}\u{1d7d6}\u{1d7d5}\u{1d7d4}\u{1d7d3}\u{1d7d2}\u{1d7d1}\u{1d7d0}\u{1d7cf}\u{1d7ce}", kind: "phone" },
  { text: "٩٨٧٦٥٤٣٢١٠ call", kind: "phone" },
  { text: "९८७६५४३२१०", kind: "phone" },
  { text: "９８７６５４３２１０", kind: "phone" },
  { text: "⑨⑧⑦⑥⑤④③②①⓪", kind: "phone" },
  { text: "9️⃣8️⃣7️⃣6️⃣5️⃣4️⃣3️⃣2️⃣1️⃣0️⃣", kind: "phone" },
  { text: "nine eight seven six five four three two one zero", kind: "phone" },
  { text: "98765 four three two one zero", kind: "phone" },
  { text: "call me at nine eight seven six five 4 3 2 1 0", kind: "phone" },
  { text: "account 123456789012", kind: "phone" },
  { text: "my whatsapp number is 98765 43210", kind: "phone" },

  // ---- emails, written plainly or spelled out ----
  { text: "mail ravi.k@example.com please", kind: "email" },
  { text: "ravi @ gmail . com", kind: "email" },
  { text: "mail me at a (at) b (dot) com", kind: "email" },
  { text: "reach me: ravi [at] example [dot] in", kind: "email" },
  { text: "ravi at example dot com", kind: "email" },
  { text: "ravi(at)example.com", kind: "email" },
  { text: "ravi (at) gmail", kind: "email" },
  { text: "write to ravi at gmail", kind: "email" },

  // ---- UPI ids are payment handles (S1-4) ----
  { text: "pay me on name@okaxis", kind: "upi" },
  { text: "my upi is ravi@ybl", kind: "upi" },
  { text: "send to 9876@ybl", kind: "upi" },
  { text: "ravi @ ybl", kind: "upi" },
  { text: "my upi is ravi_k", kind: "upi" },

  // ---- links, with or without http or www (S1-6) ----
  { text: "see www.example.com/portfolio", kind: "link" },
  { text: "https://example.org/x", kind: "link" },
  { text: "see ravifixes.in", kind: "link" },
  { text: "bit.ly/abcd1", kind: "link" },
  { text: "linktr.ee/ravi", kind: "link" },
  { text: "youtu.be/abc", kind: "link" },
  { text: "wa.me/ravi", kind: "link" },

  // ---- handles and chat apps (S1-6, S6-39) ----
  { text: "@ravi_fixes will do it", kind: "handle" },
  { text: "my insta is ravi_fixes", kind: "handle" },
  { text: "insta: ravi_fixes", kind: "handle" },
  { text: "insta ravi", kind: "handle" },
  { text: "DM me on insta ravi_k", kind: "handle" },
  { text: "whatsapp ravi_k", kind: "handle" },
  { text: "whatsapp me on", kind: "handle" },
  { text: "telegram ravi99", kind: "handle" },
  { text: "ping me on telegram", kind: "handle" },
  { text: "add me on snapchat", kind: "handle" },

  // ---- door-level addresses ----
  { text: "Flat 12B, Green Park, near the temple", kind: "address" },
  { text: "Flat402, Madhapur", kind: "address" },
  { text: "#45, 2nd main road", kind: "address" },
  { text: "12/3, 5th cross Indiranagar", kind: "address" },
  { text: "my address is near the temple", kind: "address" },
  { text: "House no 12, Green Park", kind: "address" },
  { text: "Shop 4, MG Road", kind: "address" },

  // ---- ordinary work talk that must go through (S3-30, S3-31, S6-40) ----
  { text: "Fix a leaking tap, 2 hours, tools needed", kind: null },
  { text: "Order 3 boxes of 12 on 2nd floor", kind: null },
  { text: "I have fixed 40 taps and can start tomorrow morning.", kind: null },
  { text: "I need one or two people, three hours, four pm", kind: null },
  { text: "one two three", kind: null },
  { text: "2️⃣ people for 3️⃣ hours", kind: null },
  { text: "I can do it for ₹250000 by Friday", kind: null },
  { text: "Budget 5000-10000 depending on size", kind: null },
  { text: "Need 2 painters for 10000 - 20000 sq ft office", kind: null },
  { text: "Budget 75000-80000", kind: null },
  { text: "Budget 1,50,000 - 2,00,000", kind: null },
  { text: "Quotes so far 1,500, 2,000, 3,000", kind: null },
  { text: "Order id 123456789", kind: null },
  { text: "I can pay 150000 for the full job", kind: null },
  { text: "I am in Madhapur 500081", kind: null },
  { text: "PIN 560001 area", kind: null },
  { text: "Door 2 door delivery please", kind: null },
  { text: "shop 5 min away", kind: null },
  { text: "#1, best price", kind: null },
  { text: "ok see you 12.03.2026 18", kind: null },
  { text: "Manage my Instagram page", kind: null },
  { text: "Set up WhatsApp Business for my shop", kind: null },
  { text: "Instagram marketing for my bakery", kind: null },
  { text: "Telegram bot setup", kind: null },
  { text: "WhatsApp 24/7 support needed", kind: null },
  { text: "call me on Monday", kind: null },
  { text: "meet @5pm at the gate", kind: null },
  { text: "snap a photo of the meter", kind: null },
  { text: "I am at the gate, 5 minutes", kind: null },
  { text: "meet at the shop, dot the i's", kind: null },
  { text: "arrive at 5 pm", kind: null },
  { text: "pay via UPI is fine", kind: null },
  { text: "Need help with Node.js and React", kind: null },
  { text: "Paint my house 2 coats", kind: null },
  { text: "4th block Jayanagar, near the park", kind: null },
  { text: "Need instagram help", kind: null },
  { text: "flat 2 bhk needed", kind: null },
];

/** Names and usernames: a phone number or an email in any shape is refused (S1-8). */
export const NAME_CASES: { text: string; carries: boolean }[] = [
  { text: "r98765_43210", carries: true },
  { text: "r9876543210", carries: true },
  { text: "@9876543210", carries: true },
  { text: "ravi.k@example.com", carries: true },
  { text: "ravi@okaxis", carries: true },
  { text: "९८७६५४३२१०", carries: true },
  { text: "Ravi Kumar", carries: false },
  { text: "ravi_2024", carries: false },
  { text: "Flat 402 fan", carries: false },
];
