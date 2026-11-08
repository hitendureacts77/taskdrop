/**
 * The words for the three "how it works" sheets: a City Hunt as the person who
 * posts it, a Hunt as the person who finds, and Plan a big day. Kept apart from
 * the sheet (components/ExplainerSheet.tsx) so the copy is plain data that a
 * test can read, and so there is one place to fix a sentence. Pure: no React.
 *
 * The scene ids pick one of the small drawings in components/HowItWorks.tsx.
 * `{fee}` in a line is the live customer service fee: run text through
 * fillFee() before showing it.
 */

export type ExplainerKey = 'hunt' | 'huntFinder' | 'bigDay';

export type ExplainerScene = 'describe' | 'quotes' | 'escrow' | 'done' | 'find' | 'quote' | 'work' | 'paid';

export type ExplainerStep = { scene: ExplainerScene; title: string; body: string };

/**
 * `prompt` is a ready sentence that pre-fills the Hunt post box; `event` is a
 * Big Day event key (lib/bigDays.ts). Both are optional: finders see the
 * examples as plain cards.
 */
export type ExplainerExample = { title: string; detail: string; prompt?: string; event?: string };

export type Explainer = {
  title: string;
  subtitle: string;
  steps: ExplainerStep[];
  whoForTitle: string;
  whoFor: string[];
  examplesTitle: string;
  examples: ExplainerExample[];
  footnote?: string;
  doneLabel: string;
};

const HUNT_EXAMPLES: ExplainerExample[] = [
  {
    title: 'Insulin pens in stock',
    detail: 'Near Kondapur, Hyderabad · today',
    prompt: 'Find me Lantus insulin pens in stock at a chemist near Kondapur, Hyderabad',
  },
  {
    title: 'A laptop charger',
    detail: 'SP Road, Bengaluru · 2 hours',
    prompt: 'Find me a 65W Lenovo laptop charger in stock on SP Road, Bengaluru, with the price',
  },
  {
    title: 'Baby formula',
    detail: 'Andheri West, Mumbai · today',
    prompt: 'Find me which shop near Andheri West has NAN Pro 1 baby formula, with the price',
  },
  {
    title: 'An old radio repair shop',
    detail: 'Pune · 3 days',
    prompt: 'Find me a shop in Pune that repairs old Philips radios, with a photo of the shop',
  },
];

// The finder sees the same four requests, as plain cards: no prompt to use.
const FINDER_EXAMPLES: ExplainerExample[] = HUNT_EXAMPLES.map(({ title, detail }) => ({ title, detail }));

export const EXPLAINERS: Record<ExplainerKey, Explainer> = {
  hunt: {
    title: 'What is a Hunt?',
    subtitle: 'Find it for me: many people look at once, and you pay only the finder.',
    steps: [
      {
        scene: 'describe',
        title: 'Say what you want found.',
        body: 'Type what you need and where. Pick how long people can look: 2 hours, today or 3 days.',
      },
      {
        scene: 'find',
        title: 'Many people look at once.',
        body: 'People nearby or online start looking. Each one sends a find: a photo taken right then, the shop name, a pin or the price.',
      },
      {
        scene: 'done',
        title: 'Pay only the find you pick.',
        body: 'Nothing is taken when you post. You pay the reward, plus the {fee}% service fee, only for the find you accept. Nothing found, nothing paid.',
      },
    ],
    whoForTitle: 'WHO IT IS FOR',
    whoFor: [
      'You need something soon and do not know which shop has it',
      'Shops keep saying out of stock and you are tired of calling around',
      'You want to pay only when someone really finds it',
    ],
    examplesTitle: 'EXAMPLES (tap to try)',
    examples: HUNT_EXAMPLES,
    footnote: 'You set the reward on the Budget step.',
    doneLabel: 'Got it',
  },
  huntFinder: {
    title: 'How a Hunt works for you',
    subtitle: 'Help someone find something and earn the reward.',
    steps: [
      {
        scene: 'find',
        title: 'Look for it.',
        body: "Tap I'm looking so the customer knows. Check shops near you, or look online.",
      },
      {
        scene: 'work',
        title: 'Send a find.',
        body: 'Take a photo right there and add the shop name, a pin or the price. You can send up to 3 finds.',
      },
      {
        scene: 'paid',
        title: 'Get the reward.',
        body: 'If the customer picks your find, you are paid the reward like any job, after the usual commission. If not, nothing is lost.',
      },
    ],
    whoForTitle: 'WHO IT IS FOR',
    whoFor: [
      'You are out and about and know your area',
      'You are good at tracking things down',
      'You want quick, small earnings',
    ],
    examplesTitle: 'EXAMPLES',
    examples: FINDER_EXAMPLES,
    doneLabel: 'Got it',
  },
  bigDay: {
    title: 'What is Plan a big day?',
    subtitle: 'One date in, a whole plan out. A helper for each part of your day.',
    steps: [
      {
        scene: 'describe',
        title: 'Pick the day.',
        body: 'Choose what is happening, like shifting house or a wedding at home, and the date.',
      },
      {
        scene: 'quotes',
        title: 'Get a ready plan.',
        body: 'TaskDrop lists the jobs around that day, like packing help the day before and cleaning after. Tick the ones you want and change any line.',
      },
      {
        scene: 'escrow',
        title: 'Post each job when you are ready.',
        body: 'Each line becomes a normal task. You set the price, compare offers and your money is held safely until you approve the work.',
      },
    ],
    whoForTitle: 'WHO IT IS FOR',
    whoFor: [
      'A big day with many small jobs: shifting house, a wedding, a festival, a birthday',
      'You do not want to forget anything or plan it all in your head',
      'You want different helpers for different jobs, near you or online',
    ],
    examplesTitle: 'EXAMPLES (tap to start with it)',
    examples: [
      {
        title: 'Shifting house',
        event: 'moving',
        detail: 'Packing help the day before · Fit fans and the geyser on the day · Deep clean the old flat after',
      },
      {
        title: 'Wedding at home',
        event: 'wedding',
        detail: 'E-invitations a month before · Flower and light decoration the day before · Help serving guests on the day',
      },
      {
        title: 'Birthday party',
        event: 'birthday',
        detail: 'Birthday e-invites · Balloon and room decoration · Help with snacks, then clearing up',
      },
      {
        title: 'Diwali cleaning',
        event: 'festival',
        detail: 'Full-home deep clean · Sofa and curtain cleaning · Rangoli on the day',
      },
    ],
    footnote: 'Your plan is saved on this phone. Tasks you post show in My Tasks.',
    doneLabel: 'Start planning',
  },
};

/** The text of the small links that reopen an explainer. */
export const HUNT_LINK = 'How a Hunt works';
export const BIG_DAY_LINK = 'How Plan a big day works';

/** Puts the live customer service fee (a percentage number) where a line says {fee}. */
export function fillFee(text: string, feePct: number): string {
  return text.split('{fee}').join(String(feePct));
}
