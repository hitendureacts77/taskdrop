import { company, contactLine } from './company';

/**
 * The Terms of Service and Privacy Policy, as data for LegalPage.
 *
 * DRAFTS for a lawyer to review -- written from what the code actually does
 * (what is collected, where it goes, how money moves), not from a template.
 * When the app changes what it collects or how money moves, change this file
 * in the same commit. Fees and day counts are not repeated here: they are
 * admin-configurable, so the text points at "How fees work", which reads the
 * live values.
 */

export type LegalBlock = string | { list: string[] };
export type LegalSection = { heading: string; body: LegalBlock[] };
export type LegalDoc = { title: string; updated: string; intro: string; sections: LegalSection[] };

const UPDATED = '6 October 2026';
const who = company.entity;
// "Acme Pvt Ltd runs TaskDrop", or just "TaskDrop" until the entity is set.
const named = who !== 'TaskDrop';
const reach = contactLine(company.email);
const officer = [
  company.grievanceName ? `Grievance Officer: ${company.grievanceName}` : 'Grievance Officer',
  company.grievanceEmail ? `Email: ${company.grievanceEmail}` : 'Contact: Help & support in the app',
  ...(company.address ? [`Post: ${company.address}`] : []),
];

export const PRIVACY: LegalDoc = {
  title: 'Privacy Policy',
  updated: UPDATED,
  intro: `${named ? `${who} runs TaskDrop,` : 'TaskDrop is'} an app where people post jobs they need done and people nearby offer to do them. This policy explains what we collect, why, who it goes to, and the choices you have. It covers TaskDrop on Android and on the web.`,
  sections: [
    {
      heading: 'What we collect',
      body: [
        {
          list: [
            'Your mobile number, to sign you in with a code sent by text. If you sign in with Google instead, your Google email address and name. If you set a username and password, the password is stored only in scrambled (hashed) form.',
            'Your date of birth, asked once to confirm you are 18 or over. It is private and never shown on your profile.',
            'Your profile: display name, username, photo, bio, skills, languages, and whether you came to hire, earn or both.',
            'Location, only if you allow it and only while the app is open (TaskDrop never asks for background location). Your exact position is kept private. Other people see an area rounded to about 1 km. The exact place of a job is shared only with the worker hired for it.',
            'What you post and send: job posts and the photos or videos you attach, offers, chat messages, proof of finished work, reviews, disputes, help requests and feedback.',
            'Payments: Razorpay processes card, UPI and net-banking payments; we never see or store your card number. We keep the amounts, dates and status of payments and refunds, and your TaskDrop wallet balances.',
            'Withdrawals: the UPI ID, or bank account number, IFSC and account holder name, you choose to be paid to, and the name on your payout profile.',
            'Activity: when you were last active (shown to others as “Active now” or “Away”), views and taps on promoted posts, and referral codes you used.',
            'Device: a push-notification token if you allow notifications. If crash reporting is on, a crash report holds the error, the part of the app it happened in, your platform and the app version, and nothing about your account.',
          ],
        },
      ],
    },
    {
      heading: 'How we use it',
      body: [
        {
          list: [
            'To run TaskDrop: sign you in, show jobs and people near you, hold and release payments, pay out earnings, and send notifications.',
            'To keep it safe: limit repeated attempts, stop fraud and abuse, suspend accounts that break the rules, and settle disputes using the job’s chat and proof of work.',
            'To answer you when you ask for help.',
            'To meet legal duties, such as keeping payment and tax records.',
            'To understand how TaskDrop is used, through totals that do not identify you.',
          ],
        },
        'We do not sell your personal data, and we do not use outside advertising networks. Promoted posts are shown only inside TaskDrop.',
      ],
    },
    {
      heading: 'Who sees it',
      body: [
        'Other people on TaskDrop see your public profile: name, username, photo, bio, skills, languages, rough area, ratings and reviews, how many jobs you have done, and your open posts. Once work on a job starts, the customer and the hired worker can see each other’s phone number.',
        'Companies that run parts of TaskDrop for us, each receiving only what its job needs:',
        {
          list: [
            'Supabase: our database, sign-in and file storage, on servers in Mumbai, India.',
            'Razorpay and RazorpayX: payments, refunds and payouts.',
            'MSG91: sends your sign-in codes by text.',
            'Google: Google sign-in, if you use it; place search, when we use Google Places; and voice typing on the web, which uses your browser’s speech service (Google’s, in Chrome).',
            'OpenStreetMap (Nominatim): place search and turning a map pin into an address. It receives the words you search or the pin’s position.',
            'Expo: delivers push notifications to your phone.',
            'Sentry: crash reports, if crash reporting is on.',
            'n8n, the tool we use to alert our team (for example about a new help request). It receives names and amounts, never phone numbers, email addresses, bank details or UPI IDs.',
          ],
        },
        'Our staff can see account and job details when they handle help requests, disputes, payouts and reports. Their actions on accounts and money are recorded in an audit log.',
        'We share information with the police, courts or regulators only when the law requires it.',
      ],
    },
    {
      heading: 'How long we keep it',
      body: [
        'We keep your information while your account is open. Payment, refund and payout records are kept for as long as Indian tax and accounting law requires, even after an account closes. Sign-in codes expire after 10 minutes and are deleted once used. Our own log of team alerts is deleted after 30 days.',
        'When you delete your account (Account & settings → Sign-in → Delete account), we immediately remove your name, username, photo, bio, skills, location, date of birth, saved payout details, saved tasks, notifications and every way of signing in, and sign you out on every device. Requests nobody had paid for are taken down, and quotes that never became a job are removed. Tasks that went ahead stay, with their messages, proof of work and reviews, shown under “Deleted user”, because the other person and our payment records depend on them. Payments, refunds and payouts stay too, and so do your PAN and legal name if we ever sent you a payout. Your phone number and Google account are released, so signing in with them again starts a new, empty account.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'Under India’s Digital Personal Data Protection Act, 2023, you can ask us for a summary of the personal data we hold about you, have it corrected or completed, have it erased, and nominate someone to act for you if you die or cannot act yourself. You can delete your account yourself in the app (see above). To do any of the others, ' +
          reach +
          '. We will delete what we are not required by law to keep.',
        'You can also turn off location and notifications at any time in your phone’s settings.',
      ],
    },
    {
      heading: 'Children',
      body: [
        'TaskDrop is only for people aged 18 or over. If we learn that someone under 18 has an account, we close it and delete their information, except records we must keep because they involve other people’s payments.',
      ],
    },
    {
      heading: 'Security',
      body: [
        'Your data travels encrypted. Photos and videos are stored privately and shown through short-lived links. On Android your sign-in is kept in the phone’s secure storage. Access to your data is limited by rules inside the database itself. No system is perfectly secure, so please tell us at once if you think your account has been misused.',
      ],
    },
    {
      heading: 'Complaints',
      body: [
        'If you have a concern about how we handle your data, contact our Grievance Officer. We acknowledge complaints within 24 hours and aim to resolve them within 15 days.',
        { list: officer },
        'If you are not satisfied with our answer, you can complain to the Data Protection Board of India.',
      ],
    },
    {
      heading: 'Changes to this policy',
      body: [
        'When we change this policy we update the date at the top, and we tell you in the app before a significant change takes effect.',
      ],
    },
  ],
};

export const TERMS: LegalDoc = {
  title: 'Terms of Service',
  updated: UPDATED,
  intro: `These terms are an agreement between you and ${named ? `${who}, which runs TaskDrop` : 'TaskDrop'}. By creating an account or using TaskDrop you agree to them, to the Privacy Policy, and to the copyright rules on the Copyright page.`,
  sections: [
    {
      heading: 'Who can use TaskDrop',
      body: [
        {
          list: [
            'You must be 18 or over and able to make a binding contract.',
            'One account per person. The details you give us must be true, and you are responsible for everything done through your account, so keep your phone and password safe.',
            'We may ask you to confirm details, and we may refuse or close accounts as these terms describe.',
          ],
        },
      ],
    },
    {
      heading: 'What TaskDrop is',
      body: [
        'TaskDrop is a marketplace. Customers describe jobs; workers send offers. When a customer accepts an offer, the agreement to do that job is between the customer and the worker. TaskDrop is not the employer or agent of either side and is not a party to that agreement.',
        'Workers are independent. They decide how to do the work and are responsible for their own skills, tools, any licences the job needs, and their own taxes. We do not run background checks or verify identity unless we say so on a profile.',
      ],
    },
    {
      heading: 'Posts, offers and conduct',
      body: [
        'Describe jobs and offers honestly, and only post work that is legal and safe. You must not use TaskDrop to:',
        {
          list: [
            'offer or ask for anything illegal, dangerous, sexual, or that needs a licence you do not have;',
            'harass, threaten, discriminate against or mislead anyone;',
            'post fake reviews, spam, or someone else’s content without permission;',
            'take payment for a TaskDrop job outside TaskDrop to avoid fees or our payment protection;',
            'interfere with TaskDrop, its security, or other people’s accounts.',
          ],
        },
        'To protect both sides, a job’s exact address is shared only with the worker who is hired, and phone numbers stay hidden until work starts. For jobs done in person, take the same care you would with anyone you have just met, and tell us through the app if something goes wrong.',
      ],
    },
    {
      heading: 'Paying and getting paid',
      body: [
        {
          list: [
            'Fees. What TaskDrop charges is on the How fees work page, which always shows the current figures: a fee added to the price when you hire, a commission taken from the price when you earn, and a fee on cancellations after work has started. Posting and making offers are free.',
            'Payment is held. When a customer accepts an offer, they pay the price plus the hiring fee, through Razorpay or with TaskDrop credits. TaskDrop holds the money until the job is approved.',
            'Approval. When the worker marks the job done, the customer approves it or asks for changes within the review period shown on the job. If they do neither, the payment is released to the worker automatically.',
            'Earnings. Released earnings, less the commission, become available after the clearing period shown on How fees work, and can then be withdrawn to UPI or a bank account, with no withdrawal fee, above the minimum shown in the app.',
            'Credits. Money you add to your TaskDrop wallet is credit for paying for jobs on TaskDrop. It cannot be withdrawn to a bank account.',
            'Cancelling. If a job is cancelled before work starts, the customer gets their money back the way the app shows when cancelling. If the customer cancels after the worker has started, the worker is paid the cancellation fee for the time they put in, and the rest is refunded.',
            'Disputes. Either side can open a dispute about a job. TaskDrop looks at the job, its chat and the proof of work, and decides how the held money is split. That decides the held money on TaskDrop; it does not take away any other legal right you have.',
            'Promoting a post. A promotion is paid once, up front, and does not renew. You pay only for the reach that is delivered: what is not delivered, including if you stop early, comes back to your TaskDrop wallet when the promotion ends. Reach figures are estimates.',
            'Taxes. You are responsible for any tax on what you earn through TaskDrop.',
          ],
        },
      ],
    },
    {
      heading: 'Your content',
      body: [
        'What you post stays yours. You give TaskDrop permission to store, copy, resize and show it, to the extent needed to run and promote TaskDrop, for as long as it is on TaskDrop. You must have the right to post it.',
        'We may remove anything that breaks these terms or the law. We respond to copyright notices as described on the Copyright page, and we close the accounts of people who repeatedly post material that infringes someone else’s copyright.',
      ],
    },
    {
      heading: 'Suspending and closing accounts',
      body: [
        'You can stop using TaskDrop at any time and delete your account in the app, under Account & settings. An account can be deleted once nothing is still in progress: no money in the wallet or on its way to you, and no task under way or in dispute. We may suspend or close an account that breaks these terms, belongs to someone under 18, or repeatedly infringes copyright. Money already owed to you is still paid, unless it is part of a dispute or of fraud we are investigating.',
      ],
    },
    {
      heading: 'Our responsibility',
      body: [
        'We work to keep TaskDrop running and safe, but we provide it as it is. We are not responsible for the quality, safety or legality of jobs, or for what customers and workers do. As far as the law allows, our total liability to you for any claim is limited to the fees you paid TaskDrop in the 12 months before it. Nothing in these terms takes away rights you have under the Consumer Protection Act, 2019 or any other law that cannot be excluded.',
      ],
    },
    {
      heading: 'Complaints and disputes with us',
      body: [
        'For any complaint about TaskDrop, including about content on it, contact our Grievance Officer. We acknowledge complaints within 24 hours and aim to resolve them within 15 days.',
        { list: officer },
        `These terms are governed by the laws of India${company.jurisdiction ? `, and the courts at ${company.jurisdiction} have jurisdiction over any dispute about them` : ''}.`,
      ],
    },
    {
      heading: 'Changes to these terms',
      body: [
        'When we change these terms we update the date at the top, and we tell you in the app before a significant change takes effect. If you keep using TaskDrop after that, the new terms apply.',
      ],
    },
  ],
};
