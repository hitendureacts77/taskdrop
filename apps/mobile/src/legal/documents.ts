import { company, contactLine } from './company';

/**
 * The Terms of Service and Privacy Policy, as data for LegalPage.
 *
 * DRAFTS for a lawyer to review -- written from what the code actually does
 * (what is collected, where it goes, how money moves), not from a template.
 * Every claim is traced to a file in docs/LEGAL_AUDIT.md; when the app changes
 * what it collects or how money moves, change this file and that table in the
 * same commit. Fees and day counts are not repeated here: they are
 * admin-configurable, so the text points at "How fees work", which reads the
 * live values.
 *
 * `npm run legal:export` renders both documents to docs/legal/*.md with
 * [BRACKETED PLACEHOLDERS] for the company details that are still unset.
 */

export type LegalBlock = string | { list: string[] };
export type LegalSection = { heading: string; body: LegalBlock[] };
export type LegalDoc = { title: string; updated: string; intro: string; sections: LegalSection[] };

const UPDATED = '19 October 2026';
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
  intro: `${named ? `${who} runs TaskDrop,` : 'TaskDrop is'} an app where people post jobs they need done and others offer to do them, in person nearby or online from anywhere. This policy explains what we collect, why, who it goes to, and the choices you have. It covers the TaskDrop apps and the TaskDrop website.`,
  sections: [
    {
      heading: 'What we collect',
      body: [
        {
          list: [
            'Sign-in: your mobile number, to sign you in with a code sent by text. If you sign in with Google or Apple instead, the email address and name they share with us (Apple may give a private relay address). If you set a username and password, the password is stored only in scrambled (hashed) form.',
            'Your date of birth, asked once to confirm you are 18 or over. It is private and never shown on your profile.',
            'Your profile: display name, username, photo, bio, skills, languages, and whether you came to hire, earn or both.',
            'Location, only if you allow it and only while the app is open (TaskDrop never asks for background location). Your exact position is kept private. Other people see an area rounded to about 1 km. The exact place of a job is shared only with the worker hired for it. Place searches you make, and the spot you drag a map pin to, are sent to the place-search services listed below.',
            'What you post and send: job posts, the photos, videos and files you attach, offers, chat messages and chat photos, proof of finished work, reviews, disputes, reports, help requests and feedback. The camera, microphone and photo library are used only when you choose to attach something.',
            'Payments: Razorpay processes card, UPI and net-banking payments on its own page; we never see or store your card number. We keep the amounts, dates, status and Razorpay reference of payments and refunds, and your TaskDrop wallet balance and history.',
            'Withdrawals: the UPI ID, or bank account number, IFSC and account holder name, you choose to be paid to. Before your first withdrawal we also ask for your full name as on your PAN card and your PAN. The app shows you only the last four characters of it afterwards.',
            'Activity: when you were last active (shown to others as “Active now” or “Away”), tasks you saved, views and taps on promoted posts, who referred you, and people you blocked or reported.',
            'Device and connection: the kind of device (web, Android or iPhone), the app version, the operating system version, and a random install ID that tells one installation of the app from another. A push-notification token if you allow notifications. Your IP address, when you ask for a sign-in code or try a password, so we can stop abuse. Like any online service, the companies that host TaskDrop see your IP address when your phone or browser connects.',
            'Crash reports: if crash reporting is on, a report holds the error, the part of the app it happened in, your platform and the app version, and nothing about your account. On phones it can also record how you move through the app, with all text, pictures and icons hidden, so a name, address, amount or message is never in it.',
            'On the web, the TaskDrop site keeps your sign-in in your browser’s storage so you stay signed in. On phones it is kept in the phone’s secure storage. We do not use advertising cookies or trackers.',
          ],
        },
      ],
    },
    {
      heading: 'How we use it',
      body: [
        {
          list: [
            'To run TaskDrop: sign you in, show jobs and people near you, hold and release payments, pay out earnings, and send notifications about your jobs and money.',
            'To keep it safe: limit repeated attempts, stop fraud and abuse, suspend accounts that break the rules, review reports, and settle disputes using the job’s chat and proof of work.',
            'To answer you when you ask for help, and to tell you about changes to TaskDrop, sometimes as a message from our team in the app.',
            'To meet legal duties, such as keeping payment and tax records.',
            'To understand how TaskDrop is used, through totals that do not identify you, and to find and fix problems.',
          ],
        },
        'We do not sell your personal data, and we do not use outside advertising networks. Promoted posts are shown only inside TaskDrop.',
      ],
    },
    {
      heading: 'Who sees it',
      body: [
        'Other people on TaskDrop see your public profile: name, username, photo, bio, skills, languages, rough area, ratings and reviews, how many jobs you have done, and your open posts. Your reviews are public. Once work on a job starts, the customer and the hired worker can see each other’s phone number and the job’s exact address.',
        'Companies that run parts of TaskDrop for us, each receiving only what its job needs. Some of them may process data outside India.',
        {
          list: [
            'Supabase: our database, sign-in and storage of videos and documents, on servers in Mumbai, India.',
            'ImageKit: stores your photos and delivers them to the people allowed to see them, through short-lived private links.',
            'Vercel: hosts the TaskDrop website and the screens our team uses.',
            'Razorpay and RazorpayX: payments, refunds and payouts. They also collect what they need to verify payments and payouts, under their own privacy policies.',
            'MSG91: sends your sign-in codes by text.',
            'Google: Google sign-in, if you use it; place search through Google Places, which your device contacts directly with the words you type; the map on Android; and voice typing on the web, which uses your browser’s speech service (Google’s, in Chrome).',
            'Apple: Sign in with Apple, if you use it, and the map on iPhone.',
            'OpenStreetMap (Nominatim and map tiles): place search when Google Places is not used, turning a map pin into an address, and the map pictures on the web. It receives the words you search or the pin’s position, and, for map pictures, your device’s IP address.',
            'Expo: delivers push notifications to your phone.',
            'Sentry: crash reports, error logs and usage counts (for example, tasks posted), so we can find and fix problems. It is used only if monitoring is on.',
            'Inngest, which runs our background jobs and alerts our team (for example about a new help request). It receives names and amounts, never phone numbers, email addresses, bank details or UPI IDs.',
          ],
        },
        'Our staff can see account and job details when they handle help requests, reports, disputes, payouts and takedowns. They keep private notes and tags on accounts to do this work. Their actions on accounts and money are recorded in an audit log, and sensitive money actions need a second sign-in step.',
        'We share information with the police, courts or regulators only when the law requires it.',
      ],
    },
    {
      heading: 'How long we keep it',
      body: [
        'We keep your information while your account is open. Payment, refund and payout records are kept for as long as Indian tax and accounting law requires, even after an account closes.',
        'Some records are short-lived: sign-in codes expire after 10 minutes and expired ones are cleared daily; the count of codes sent to an IP address is cleared after a day; password attempts (the username and IP address) are kept for 30 days; in-app notifications for 90 days; our internal alert log and our team’s live activity feed for 30 days.',
        'When you delete your account (Account & settings → Delete account), we immediately remove your name, username, photo, bio, skills, location, date of birth, saved payout details, saved tasks, notifications, device records, referrals, blocks and every way of signing in, and sign you out on every device. Every chat message you sent is deleted. Requests nobody had paid for are emptied and taken down along with their chats, and quotes that never became a job are removed. Your photos and files are deleted too, except those a kept record still needs.',
        'What stays, because other people or the law depend on it: paid tasks, with their proof of work and reviews, shown under “Deleted user”; payments, refunds, payouts and wallet history; your PAN and legal name if we ever sent you a payout; disputes, help conversations and reports; and private notes our team wrote. Your phone number and Google or Apple account are released, so signing in with them again starts a new, empty account.',
        'You can delete your account once nothing is still in progress: no money in the wallet or on its way to you, and no task under way or in dispute. The app tells you what is in the way.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        'Under India’s Digital Personal Data Protection Act, 2023, you can ask us for a summary of the personal data we hold about you, have it corrected or completed, have it erased, withdraw your consent, and nominate someone to act for you if you die or cannot act yourself. You can delete your account yourself in the app (see above) and change your profile details under Account & settings. To do any of the others, ' +
          reach +
          '. We will delete what we are not required by law to keep.',
        'You can also turn off location, camera, photos and notifications at any time in your phone’s settings.',
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
        'Your data travels encrypted. Photos and videos are stored privately and shown through short-lived links. On phones your sign-in is kept in the phone’s secure storage. Access to your data is limited by rules inside the database itself, and we limit repeated sign-in and request attempts. No system is perfectly secure, so please tell us at once if you think your account has been misused.',
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
            'You must be 18 or over and able to make a binding contract. We ask your date of birth when you join.',
            'One account per person. The details you give us must be true, and you are responsible for everything done through your account, so keep your phone and password safe.',
            'We may ask you to confirm details, and we may refuse or close accounts as these terms describe.',
          ],
        },
      ],
    },
    {
      heading: 'What TaskDrop is',
      body: [
        'TaskDrop is a marketplace. Customers describe jobs, to be done in person or online; workers send offers. When a customer accepts an offer, the agreement to do that job is between the customer and the worker. TaskDrop is not the employer or agent of either side and is not a party to that agreement.',
        'Workers are independent. They decide how to do the work and are responsible for their own skills, tools, any licences the job needs, and their own taxes. We do not run background checks. A “Phone” or “Email” mark on a profile means that number or address was confirmed; it does not confirm who the person is.',
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
        'To protect both sides, a job’s exact address is shared only with the worker who is hired, and phone numbers stay hidden until work starts. For jobs done in person, take the same care you would with anyone you have just met.',
        'You can report a person or a post from the app, and block a person. Our team reviews reports, and may hide a post, remove content, or suspend an account.',
      ],
    },
    {
      heading: 'Paying and getting paid',
      body: [
        {
          list: [
            'Fees. What TaskDrop charges is on the How fees work page, which always shows the current figures: a fee added to the price when you hire, a commission taken from the price when you earn, and a fee on cancellations after work has started. Posting and making offers are free.',
            'Payment is held. When a customer accepts an offer, they pay the price plus the hiring fee, through Razorpay or from their TaskDrop wallet. TaskDrop holds the money until the job is approved.',
            'Approval. When the worker marks the job done, the customer approves it or asks for changes within the review period shown on the job. If they do neither, the payment is released to the worker automatically.',
            'Earnings. Released earnings, less the commission, become available after the clearing period shown on How fees work.',
            'Your wallet. Money you add, money you earn and refunds all sit in one balance. You can spend it on jobs or withdraw it to a UPI ID or bank account you have saved, above the minimum shown in the app, with no withdrawal fee. Before your first withdrawal we ask for your full name as on your PAN card, and your PAN. Withdrawals are sent through RazorpayX. We may hold, delay or refuse a withdrawal that looks like fraud or that the law requires us to stop, and adding money and withdrawing can be paused for a while.',
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
        'What you post stays yours: your posts, photos, videos, files, chat messages and reviews. You give TaskDrop permission to store, copy, resize and show it, to the extent needed to run and promote TaskDrop, for as long as it is on TaskDrop. You must have the right to post it. The TaskDrop name, logo and app belong to TaskDrop.',
        'We may remove anything that breaks these terms or the law. We respond to copyright notices as described on the Copyright page, and we close the accounts of people who repeatedly post material that infringes someone else’s copyright.',
      ],
    },
    {
      heading: 'Other companies’ services',
      body: [
        'TaskDrop works with other companies, and their own terms apply when you use them through TaskDrop: Razorpay and RazorpayX for payments and payouts, MSG91 for sign-in texts, Google and Apple if you sign in with them, and map and place-search services. We are not responsible for their services. The Privacy Policy lists what each receives.',
      ],
    },
    {
      heading: 'Changes and availability',
      body: [
        'We may change, pause or stop parts of TaskDrop, for example for maintenance, or require you to update the app to keep using it. We do not promise TaskDrop will always be available or free of errors.',
      ],
    },
    {
      heading: 'Suspending and closing accounts',
      body: [
        'You can stop using TaskDrop at any time and delete your account in the app, under Account & settings. An account can be deleted once nothing is still in progress: no money in the wallet or on its way to you, and no task under way or in dispute. What we keep after deletion is in the Privacy Policy.',
        'We may suspend or close an account that breaks these terms, belongs to someone under 18, or repeatedly infringes copyright. A suspended account cannot sign in or withdraw money, and its jobs and money stay where they are until we have looked at them. Money owed to you is still paid out, unless it is part of a dispute, fraud we are investigating, or something the law requires us to hold.',
      ],
    },
    {
      heading: 'Our responsibility',
      body: [
        'We work to keep TaskDrop running and safe, but we provide it as it is. We are not responsible for the quality, safety or legality of jobs, or for what customers and workers do. As far as the law allows, our total liability to you for any claim is limited to the fees you paid TaskDrop in the 12 months before it. Nothing in these terms takes away rights you have under the Consumer Protection Act, 2019 or any other law that cannot be excluded.',
        'If something you post or do in breach of these terms leads to a claim against TaskDrop, you agree to cover the reasonable losses it causes us.',
      ],
    },
    {
      heading: 'Complaints, contact and disputes with us',
      body: [
        'For any complaint about TaskDrop, including about content on it, contact our Grievance Officer. We acknowledge complaints within 24 hours and aim to resolve them within 15 days. For anything else, ' +
          reach +
          '.',
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
