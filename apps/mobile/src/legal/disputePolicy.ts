/**
 * The dispute policy, the not-allowed list and the in-person safety card, as
 * plain data (plan task 4.9). The Support page, the Terms, the report screen,
 * the posting review and the safety card all read from here so the wording
 * cannot drift apart.
 *
 * Every sentence describes what the app does today (docs/DISPUTE_POLICY_DRAFT.md,
 * "How it works today"): the payment stays held, staff decide, and there are
 * exactly two outcomes -- the worker is paid, or the poster gets everything
 * back. The time limits are the owner's proposal and wait for the lawyer's
 * answer (S.3); no sentence here claims compliance with any law.
 */

/** Acknowledge within this many hours. */
export const DISPUTE_ACK_HOURS = 24;
/** Decide within this many working days. */
export const DISPUTE_DECIDE_WORKING_DAYS = 3;

export const DISPUTE_POLICY_TITLE = 'If something goes wrong on a job';

export const DISPUTE_POLICY: { heading: string; text: string }[] = [
  {
    heading: 'Report it',
    text: 'Tap Report a problem on the job. Tell us what went wrong in a sentence or two. The payment stays held while we look: nobody is paid and nobody is refunded until we decide.',
  },
  {
    heading: 'What we look at',
    text: 'The job post, the offers, the chat, the photos and files the worker sent as proof of work, and any reviews. Things said or paid outside TaskDrop cannot be checked, so we cannot rely on them.',
  },
  {
    heading: 'Who decides',
    text: 'Members of the TaskDrop team who handle disputes. They write down their reason, and the decision is recorded.',
  },
  {
    heading: 'How fast',
    text: `We aim to acknowledge your report within ${DISPUTE_ACK_HOURS} hours and decide within ${DISPUTE_DECIDE_WORKING_DAYS} working days.`,
  },
  {
    heading: 'What the decision means',
    text: 'Either the worker is paid (the price, less TaskDrop’s commission) or the poster gets back everything they paid for the job, including the hiring fee, into their TaskDrop wallet. The money is not split. The decision is final on TaskDrop; it does not take away any other legal right you have.',
  },
  {
    heading: 'Please do not',
    text: 'Report a job just because you changed your mind: cancel before work starts instead. If someone reports without a real reason, again and again, we may limit their account.',
  },
];

/** Shown under the title of the report screen. */
export const REPORT_SUBTITLE = `We aim to look within ${DISPUTE_ACK_HOURS} hours. The payment stays on hold until we decide.`;

/** The one line shown on the last step of posting. */
export const NOT_ALLOWED_LINE = 'Not allowed: illegal things, weapons, medicines, adult content, handling cash for others.';

/** The full list, for the Terms and the Support page. */
export const NOT_ALLOWED: string[] = [
  'anything illegal in India;',
  'weapons, explosives, drugs or alcohol;',
  'prescription medicines, or medical treatment or advice offered as a task;',
  'adult content or sexual services;',
  'handling cash for others (collecting, holding, carrying or lending money), or lending your bank or UPI access;',
  'fake or altered documents, exam cheating, or fake reviews;',
  'work that involves anyone under 18: TaskDrop is for people 18 and over;',
  'pressure, threats or harassment of any person;',
  'collecting other people’s personal data without their consent;',
  'anything meant to move the deal off TaskDrop, such as paying outside the app.',
];

/** What staff do with a post that breaks the list. */
export const NOT_ALLOWED_ACTION = 'A post that breaks these rules can be hidden by the TaskDrop team, and the poster is told why.';

export const SAFETY_CARD_TITLE = 'Staying safe on a job';

export const SAFETY_CARD: string[] = [
  'Meet where other people can see you when you can, and tell someone you trust where you are going.',
  'Never share a sign-in code, a PIN, a bank password or your card details with anyone. TaskDrop never asks for them.',
  'Keep the chat and the payment inside TaskDrop. Paying outside the app removes the protection of held money.',
  'If you feel unsafe, leave. Then tap Report a problem (or Report on the person) so we can act.',
];
