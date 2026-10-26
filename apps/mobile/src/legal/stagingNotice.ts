/**
 * The "Staging" notice on the Terms and Privacy pages. LegalScreens shows it
 * above the document only while the app is the staging copy (never in
 * production), and `npm run legal:export` leaves it out because it is not part
 * of the document a lawyer reviews.
 *
 * It says what this copy is and asks people not to enter real personal
 * information. It makes no claim that TaskDrop follows any law or standard
 * (see docs/LEGAL_AUDIT.md: the legal text is written only from what the code
 * does). No imports, so `node --test` can read it.
 */
export const STAGING_NOTICE = {
  heading: 'Staging',
  terms:
    'This is a staging copy of TaskDrop, made for testing. The money in it is fake and nothing reaches a real bank. Everything in it is test data and can be erased at any time. Please do not enter any real personal information.',
  privacy:
    'This is a staging copy of TaskDrop, made for testing, and it should hold only made-up data. Please do not enter any real personal information, such as a real address, ID number or bank detail. What you enter here can be seen by the people who run and test TaskDrop, and can be erased at any time.',
} as const;
