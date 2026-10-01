import type { IconName } from '../components/Icon';

/**
 * Everything the "What's on your mind?" posting flow knows about turning a
 * sentence into a task post.
 *
 * The writer is the quick writer below: keyword rules that decide which quick
 * questions to ask and what the post says. It runs on the device -- posting
 * does not use AI, by the owner's choice -- so it is instant and never fails.
 */

export type Pillar = 'services' | 'procurement' | 'local_intel';

// Stored on tasks.category and shown in filters; keep in sync with the admin labels.
export const CATEGORIES = [
  'Home Services',
  'Repairs & Maintenance',
  'Errands & Delivery',
  'Shopping & Sourcing',
  'Local Checks & Info',
  'Tech & Websites',
  'Design & Creative',
  'Writing & Content',
  'Photo & Video',
  'Tutoring & Education',
  'Career & Resume',
  'Business & Consulting',
  'Events & Planning',
  'Admin & Data Entry',
  'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];

export function pillarFor(category: string): Pillar {
  if (category === 'Shopping & Sourcing') return 'procurement';
  if (category === 'Local Checks & Info') return 'local_intel';
  return 'services';
}

export const WRITING_STYLES = [
  { key: 'professional', label: 'Work' },
  { key: 'casual', label: 'Casual' },
  { key: 'short', label: 'Short & clear' },
  { key: 'detailed', label: 'Detailed' },
] as const;
export type WritingStyle = (typeof WRITING_STYLES)[number]['key'];

export type QuickQuestion = { question: string; options: string[] };
export type Answer = { question: string; answer: string };

export type Brief = {
  title: string;
  summary: string;
  bullets: string[];
  category: string;
  pillar: Pillar;
  skills: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  budgetMinInr: number;
  budgetMaxInr: number;
};


// ------------------------------------------------------------- templates ----

export type TemplateTag = 'Errands' | 'Quick jobs' | 'Creative' | 'Tech' | 'Study' | 'Work' | 'Advice';

export type Template = {
  key: string;
  title: string;
  sub: string;
  tag: TemplateTag;
  icon: IconName;
  /** What lands in the composer, ready to edit. */
  prompt: string;
  hot?: boolean;
};

export const TEMPLATE_TAGS: TemplateTag[] = ['Errands', 'Quick jobs', 'Creative', 'Tech', 'Study', 'Work', 'Advice'];

/** Starting points for a post. Each one opens the composer pre-filled. */
export const TEMPLATES: Template[] = [
  { key: 'ask-people', title: 'Get opinions', sub: 'Honest answers from real people', tag: 'Quick jobs', icon: 'users', prompt: 'Ask 10 people which of these two options they prefer and why: ' },
  { key: 'find-quotes', title: 'Price check', sub: 'Who has it and what they charge', tag: 'Errands', icon: 'search', prompt: 'Find 3 shops near me that sell ' },
  { key: 'offload', title: 'Hand off a task', sub: 'A finished piece of your work', tag: 'Work', icon: 'briefcase', prompt: 'I need someone to finish this piece of work for me: ' },
  { key: 'edit-reel', title: 'Reel editing', sub: 'Your footage, cut with music', tag: 'Creative', icon: 'play', prompt: 'Edit my raw footage into a 30-second reel with music and captions', hot: true },
  { key: 'refer-me', title: 'Job referral', sub: 'An intro, or who to reach', tag: 'Errands', icon: 'send', prompt: 'Looking for an employee referral at ' },
  { key: 'done-it', title: 'Talk to someone experienced', sub: 'Advice and next steps', tag: 'Advice', icon: 'help', prompt: 'I want advice from someone who has already ' },
  { key: 'promote', title: 'Grow my page', sub: 'Posts, and how they performed', tag: 'Creative', icon: 'trending', prompt: 'Help me promote my Instagram page for my small business' },
  { key: 'design', title: 'Logo & design', sub: 'Artwork in the sizes you need', tag: 'Creative', icon: 'edit', prompt: 'Design a logo for my ' },
  { key: 'govt-form', title: 'Govt form help', sub: 'Filled in and ready to submit', tag: 'Errands', icon: 'list', prompt: 'Help me fill and submit my ', hot: true },
  { key: 'make-call', title: 'Make a call for me', sub: 'What was said and agreed', tag: 'Errands', icon: 'phone', prompt: 'Call this office and find out ', hot: true },
  { key: 'shoot-reel', title: 'Shoot a video', sub: 'Filmed and edited, ready to post', tag: 'Creative', icon: 'play', prompt: 'Shoot and edit a short reel of my ' },
  { key: 'resume', title: 'Resume fix', sub: 'Line-by-line fixes, ATS ready', tag: 'Work', icon: 'edit', prompt: 'Review my resume and fix it for the ATS for a role in ' },
  { key: 'fix-site', title: 'Website fix', sub: 'The broken thing, working again', tag: 'Tech', icon: 'settings', prompt: 'Fix this problem on my website: ' },
  { key: 'exam-prep', title: 'Revision plan', sub: 'A plan for what to revise first', tag: 'Study', icon: 'list', prompt: 'Make me a revision plan for my exam on ' },
  { key: 'portfolio', title: 'Portfolio website', sub: 'A one-page site with your work', tag: 'Tech', icon: 'compass', prompt: 'Build a one-page portfolio website for my work as a ' },
  { key: 'shops-near', title: 'Repair shops nearby', sub: 'Which shops, the price, a number', tag: 'Errands', icon: 'pin', prompt: 'Find shops near me that repair ', hot: true },
  { key: 'local-help', title: 'Local helpers', sub: 'Three people, with rates', tag: 'Errands', icon: 'users', prompt: 'Find me 3 reliable ' },
  { key: 'area', title: 'Civic complaint', sub: 'Photos of it done, and the ticket', tag: 'Errands', icon: 'flag', prompt: 'Report the broken streetlight on my road to the municipality and share the complaint number' },
  { key: 'signups', title: 'Real signups', sub: 'Real signups, with proof', tag: 'Quick jobs', icon: 'check', prompt: 'Get 20 real people to sign up for ' },
  { key: 'check-this', title: 'On-the-spot check', sub: 'Confirmed answers, and who said so', tag: 'Quick jobs', icon: 'eye', prompt: 'Visit this place and check whether ' },
];

/** "What can we help you with?" -- situations, shuffled on the explore page. */
export type Idea = { title: string; prompt: string; tag: string; budget?: string };

export const IDEAS: Idea[] = [
  { title: 'Moving to a new city?', prompt: 'I need help finding a good neighbourhood and local services in ', tag: 'Local Guide', budget: '₹500–1,000' },
  { title: 'Career change?', prompt: 'I need help with a resume review and a mock interview for ', tag: 'Career', budget: '₹500–2,000' },
  { title: 'Photo overload?', prompt: 'Organise my phone photos into albums by trip and year', tag: 'Organisation' },
  { title: 'Budget chaos?', prompt: 'Make me a monthly household budget spreadsheet', tag: 'Finance' },
  { title: 'Eating healthier?', prompt: 'Make me a vegetarian meal plan and shopping list for the week', tag: 'Lifestyle' },
  { title: 'Admin piling up?', prompt: 'I need a virtual assistant to sort my email inbox for an hour a day', tag: 'Admin' },
  { title: 'Got a podcast?', prompt: 'Transcribe my podcast episode and write show notes', tag: 'Audio' },
  { title: 'Social media help?', prompt: 'Make a 2-week content calendar for my small business Instagram', tag: 'Marketing' },
  { title: 'Wedding coming up?', prompt: 'I need a coordinator to manage vendors on my wedding day', tag: 'Events', budget: '₹10,000–20,000' },
  { title: 'Language barrier?', prompt: 'Translate my product descriptions from English to Hindi', tag: 'Translation' },
  { title: 'Bike acting up?', prompt: 'I need a mechanic to look at my scooter at home', tag: 'Repairs', budget: '₹300–800' },
  { title: 'Renting a flat?', prompt: 'Visit a flat before I rent it and send me photos and a video', tag: 'Local Checks', budget: '₹300–600' },
];


// ------------------------------------------------------ built-in writer ----

/*
 * How a sentence becomes a post, with no AI and no network call:
 *
 *  1. normalise()  lower-cases the request and maps common Hinglish and
 *                  spelling variants onto the English words below
 *                  ("scooty" -> scooter, "nal" -> tap, "safai" -> cleaning).
 *  2. topicFor()   scores the request against every topic -- strong words
 *                  count 3, supporting words 1 -- and picks the best match,
 *                  so "fix the leaking tap in my kitchen" is plumbing, not
 *                  a kitchen clean-up.
 *  3. questions    each topic's own questions, minus any the request already
 *                  answers ("2 BHK", "my scooter"), plus "where?" for on-site
 *                  work when no place was given. Never more than four.
 *  4. the post     the answers become facts, the topic adds its checklist,
 *                  and the price range moves with the answers (a 3 BHK costs
 *                  more than one room), with urgency and regular-job notes.
 *
 * To support a new kind of task, add a topic to TOPICS.
 */

type Opt = string | { label: string; cost?: number };

type Ask = {
  question: string;
  /** Short name for the answer in the post: "Size: 2 BHK". */
  label: string;
  options: Opt[];
  /** Not asked when the request already says this. */
  skipIf?: RegExp;
};

type Topic = {
  key: string;
  category: Category;
  /** Plain words for the kind of help, used in titles and summaries. */
  noun: string;
  /** Matched against the normalised request. */
  strong: RegExp;
  weak?: RegExp;
  asks: Ask[];
  bullets: string[];
  skills: string[];
  budget: [number, number];
  difficulty: Brief['difficulty'];
  /** Done at a place, so "where?" matters. */
  onSite: boolean;
  /** Work with people or animals in your care: adds trust lines to the post. */
  care?: 'child' | 'elder' | 'pet' | 'home';
};

const x = (label: string, cost: number): Opt => ({ label, cost });

// -------------------------------------------------------------- language ----

/** Hinglish and spelling variants, mapped onto the words the topics use. */
const SYNONYMS: [RegExp, string][] = [
  [/\bscooty\b/g, 'scooter'],
  [/\b(gaadi|gadi)\b/g, 'vehicle'],
  [/\b(mistri|mechanik)\b/g, 'mechanic'],
  [/\b(bijli|light nahi|current nahi)\b/g, 'electric'],
  [/\b(nal|tonti)\b/g, 'tap'],
  [/\b(safai|saaf)\b/g, 'cleaning'],
  [/\b(jhadu pocha|jhaadu|pocha)\b/g, 'cleaning'],
  [/\b(dhobi|kapde dhona|kapde)\b/g, 'laundry clothes'],
  [/\b(press|istri)\b/g, 'ironing'],
  [/\b(darzi|darji)\b/g, 'tailor'],
  [/\b(khana|khaana|rasoi)\b/g, 'cook food'],
  [/\b(bawarchi|maharaj)\b/g, 'cook'],
  [/\b(kutta|kutte|doggy|puppy|pup)\b/g, 'dog'],
  [/\b(billi|kitten)\b/g, 'cat'],
  [/\b(bachcha|bachche|bacche|baccha|kid|kids|toddler|baby)\b/g, 'child'],
  [/\b(dadi|nani|dada|nana|buzurg|old parents|senior citizen|elderly)\b/g, 'elder'],
  [/\b(padhai|tuition|tution|tutions)\b/g, 'tutor'],
  [/\b(shaadi|shadi|vivah)\b/g, 'wedding'],
  [/\b(janamdin|bday|b'day)\b/g, 'birthday'],
  [/\b(dukaan|dukan)\b/g, 'shop'],
  [/\b(saman|samaan)\b/g, 'items'],
  [/\b(ghar)\b/g, 'home'],
  [/\b(paudhe|paudha|bagicha|bageecha)\b/g, 'garden plants'],
  [/\b(rangai|putai|whitewash)\b/g, 'painting'],
  [/\b(kakroach|cockroaches|termites|deemak|keede)\b/g, 'pest cockroach'],
  [/\b(jaldi|turant|fatafat)\b/g, 'urgent'],
  [/\b(abhi)\b/g, 'right now'],
  [/\b(roz|rozana|har din|daily basis)\b/g, 'daily'],
  [/\b(har hafte|weekly basis)\b/g, 'weekly'],
  [/\b(chahiye|karna hai|karwana hai|karwana)\b/g, 'need'],
  [/\b(sasta|kam daam)\b/g, 'cheap'],
  [/\bphotocopy|xerox\b/g, 'print'],
  [/\b(fridge|refrigerator)\b/g, 'fridge'],
  [/\b(a\/c|a c|aircon|air conditioner)\b/g, 'ac'],
  [/\b(mobile|cellphone|smartphone|iphone)\b/g, 'phone'],
  [/\b(pc|desktop|macbook|notebook computer)\b/g, 'laptop'],
  [/\b(wi-fi|wi fi|router)\b/g, 'wifi'],
  [/\b(cv|biodata)\b/g, 'resume'],
  [/\b(itr|income tax return)\b/g, 'tax return'],
  [/\b(aadhar)\b/g, 'aadhaar'],
];

function normalise(text: string): string {
  let t = ' ' + text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ') + ' ';
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  return t;
}

const URGENT = /\b(urgent|urgently|asap|emergency|immediately|right now|right away|today|tonight|within an hour|in \d+ (min|mins|minutes|hours?))\b/;
const REGULAR = /\b(daily|every ?day|every (morning|evening|night|week|weekend|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|weekly|monthly|weekdays|weekends|every weekday|mon(day)? to (fri|sat)(day|urday)?|regular|regularly|on a regular basis|twice a (day|week)|thrice a week|\d+ days a week|per month|long[- ]term|full[- ]time|part[- ]time)\b/;
const PLACE = /\b(at (my )?(home|house|flat|apartment|office|shop|place|college|hostel|pg)|my (home|house|flat|apartment|office|shop|place|hostel|pg|kitchen|bathroom|bedroom|room|balcony|terrace|garden|living room|hall)|near me|nearby|in [a-z]+ (area|sector|colony|nagar|layout|road)|sector \d+|remote|online|from home)\b/;
const REMOTE_OK = /\b(online|remote|remotely|video call|zoom|google meet|over (the )?phone|from home)\b/;

// ----------------------------------------------------------------- topics ----

const WHERE_HOME: Ask = {
  question: 'Where should this happen?',
  label: 'Location',
  options: ['At my home', 'At my office', 'Somewhere nearby', 'I’ll share the address in chat'],
  skipIf: PLACE,
};

const SIZE: Ask = {
  question: 'How big is the place?',
  label: 'Size',
  options: [x('1 room', 0.6), x('1 BHK', 1), x('2 BHK', 1.5), x('3 BHK or bigger', 2.2), x('Office or shop', 1.8)],
  skipIf: /\b(\d ?bhk|\d ?rk|studio|one room|1 room|single room|villa|duplex)\b/,
};

const TOPICS: Topic[] = [
  // ------------------------------------------------------------ repairs --
  {
    key: 'vehicle',
    category: 'Repairs & Maintenance',
    noun: 'vehicle repair',
    strong: /\b(bike|motorcycle|motorbike|scooter|activa|bullet|car|cycle|bicycle|e-bike|ebike|vehicle|puncture|flat tyre|tyre|tire|battery dead|engine|clutch|brake|chain|silencer|self start|kick start|servicing of my (bike|car|scooter))\b/,
    weak: /\b(mechanic|repair|fix|service|servicing|start(ing)? problem|won't start|not starting|noise|oil change)\b/,
    asks: [
      { question: 'What type of vehicle is it?', label: 'Vehicle', options: ['Motorcycle', 'Scooter', 'Car', x('Bicycle', 0.5), 'E-bike or e-scooter'], skipIf: /\b(motorcycle|motorbike|bike|scooter|activa|car|cycle|bicycle|e-bike|ebike)\b/ },
      { question: 'What’s the problem?', label: 'Problem', options: ['Won’t start', x('Puncture or tyre', 0.5), 'Strange noise or vibration', 'Brakes or clutch', x('General service', 1.2), 'Not sure — needs a look'], skipIf: /\b(puncture|flat tyre|won't start|not starting|brake|clutch|noise|servicing|service)\b/ },
      { question: 'Can it be ridden or driven?', label: 'Condition', options: ['Yes, it runs', x('No, it needs a mechanic to come', 1.3), x('Needs towing', 2)] },
      { question: 'Where is it right now?', label: 'Location', options: ['At my home', 'At my office', x('Stuck on the road', 1.3), 'Can bring it to a garage'], skipIf: PLACE },
    ],
    bullets: ['Check the problem and explain it before starting', 'Share the price of any parts before buying them', 'Use genuine or good-quality parts', 'Test ride or drive it with me once it’s fixed'],
    skills: ['vehicle_repair', 'on_site_service'],
    budget: [300, 1500],
    difficulty: 'medium',
    onSite: true,
  },
  {
    key: 'plumbing',
    category: 'Repairs & Maintenance',
    noun: 'plumbing work',
    strong: /\b(plumber|plumbing|leak|leaking|leakage|tap|pipe|drain|blocked|clog|clogged|flush|toilet|commode|wash basin|basin|sink|shower|water tank|tank overflow|motor pump|water pump|seepage)\b/,
    weak: /\b(water|bathroom|kitchen|fix|repair)\b/,
    asks: [
      { question: 'What’s the plumbing problem?', label: 'Problem', options: ['Leaking tap or pipe', x('Blocked drain or toilet', 1.2), 'Flush not working', x('New fitting to install', 1.3), x('Water tank or pump', 1.5)], skipIf: /\b(leak|leaking|blocked|clog|flush|install)\b/ },
      { question: 'Where is it?', label: 'Area', options: ['Bathroom', 'Kitchen', 'Balcony or outside', 'Water tank on the roof'], skipIf: /\b(bathroom|kitchen|toilet|balcony|terrace|roof)\b/ },
      { question: 'Who brings the parts?', label: 'Parts', options: ['Plumber brings them', 'I have the parts', 'Decide after a look'] },
      WHERE_HOME,
    ],
    bullets: ['Find the cause before replacing anything', 'Bring basic tools and common fittings', 'Share part prices before buying', 'Check there are no leaks before leaving', 'Clean up the work area'],
    skills: ['plumbing'],
    budget: [250, 1200],
    difficulty: 'medium',
    onSite: true,
    care: 'home',
  },
  {
    key: 'electrical',
    category: 'Repairs & Maintenance',
    noun: 'electrical work',
    strong: /\b(electrician|electric|electrical|wiring|switch|switchboard|socket|plug point|mcb|fuse|short circuit|inverter|ups|light fitting|tube ?light|ceiling fan|fan installation|chandelier|doorbell|power cut in my|no power)\b/,
    weak: /\b(light|fan|bulb|fix|repair|install)\b/,
    asks: [
      { question: 'What electrical work is needed?', label: 'Work', options: ['Fan or light not working', x('Switch or socket repair', 0.8), x('New fan or light to install', 1.1), x('Wiring or MCB issue', 1.6), x('Inverter or UPS', 1.4)] },
      { question: 'How many points or items?', label: 'Quantity', options: [x('Just one', 1), x('2–3', 1.6), x('4 or more', 2.5)] },
      { question: 'Is anything sparking or burning?', label: 'Safety', options: ['No', x('Yes — urgent', 1.4)] },
      WHERE_HOME,
    ],
    bullets: ['Switch off the mains before working', 'Use ISI-marked wires and parts', 'Share part prices before buying', 'Test every point once done'],
    skills: ['electrical'],
    budget: [200, 1200],
    difficulty: 'medium',
    onSite: true,
    care: 'home',
  },
  {
    key: 'ac',
    category: 'Repairs & Maintenance',
    noun: 'AC service',
    strong: /\b(ac|air ?conditioner|split ac|window ac|ac gas|gas refill|gas filling|ac service|ac servicing|cooling problem|not cooling)\b/,
    asks: [
      { question: 'What does the AC need?', label: 'Work', options: ['Regular service / cleaning', x('Not cooling', 1.3), x('Gas refill', 2.5), x('Installation or uninstallation', 2), x('Water leaking', 1.1)], skipIf: /\b(not cooling|gas refill|gas filling|install|installation|uninstall|servicing|leak|leaking)\b/ },
      { question: 'What type of AC?', label: 'AC type', options: ['Split AC', 'Window AC', 'Not sure'], skipIf: /\b(split|window)\b/ },
      { question: 'How many ACs?', label: 'Quantity', options: [x('1', 1), x('2', 1.8), x('3 or more', 2.6)] },
      WHERE_HOME,
    ],
    bullets: ['Check the AC and explain the issue first', 'Share the cost of gas or parts before refilling or replacing', 'Clean the filters and coils', 'Show it cooling properly before leaving'],
    skills: ['ac_repair', 'appliance_repair'],
    budget: [400, 1500],
    difficulty: 'medium',
    onSite: true,
    care: 'home',
  },
  {
    key: 'appliance',
    category: 'Repairs & Maintenance',
    noun: 'appliance repair',
    strong: /\b(fridge|washing machine|microwave|oven|geyser|water heater|water purifier|ro|chimney|mixer|grinder|induction|gas stove|stove|tv|television|dishwasher|cooler)\b/,
    weak: /\b(repair|fix|not working|broken|service)\b/,
    asks: [
      { question: 'Which appliance is it?', label: 'Appliance', options: ['Fridge', 'Washing machine', 'Geyser', 'Water purifier (RO)', 'TV', 'Microwave or chimney'], skipIf: /\b(fridge|washing machine|microwave|oven|geyser|water heater|purifier|ro|chimney|mixer|grinder|induction|stove|tv|television|dishwasher|cooler)\b/ },
      { question: 'What’s wrong with it?', label: 'Problem', options: ['Not switching on', 'Not working properly', 'Making noise', 'Leaking water', x('Regular service', 0.8)] },
      { question: 'How old is it?', label: 'Age', options: ['Under 2 years', '2–5 years', 'Over 5 years'] },
      WHERE_HOME,
    ],
    bullets: ['Diagnose the fault before starting', 'Share the price of any parts first', 'Use genuine spare parts', 'Test that it works before leaving'],
    skills: ['appliance_repair'],
    budget: [300, 1500],
    difficulty: 'medium',
    onSite: true,
    care: 'home',
  },
  {
    key: 'device',
    category: 'Repairs & Maintenance',
    noun: 'phone or laptop repair',
    strong: /\b(phone|laptop|tablet|ipad|screen (broken|cracked)|cracked screen|display broken|battery (draining|drain)|charging port|not charging|hanging|slow laptop|virus|data recovery|printer)\b/,
    weak: /\b(repair|fix|broken|replace)\b/,
    asks: [
      { question: 'Which device is it?', label: 'Device', options: ['Phone', 'Laptop or PC', 'Tablet', 'Printer'], skipIf: /\b(phone|laptop|tablet|ipad|printer)\b/ },
      { question: 'What’s the problem?', label: 'Problem', options: [x('Broken screen', 2), x('Battery or charging', 1.2), x('Slow or hanging', 0.8), x('Water damage', 1.8), x('Software or virus', 0.8), x('Data recovery', 2)] },
      { question: 'Should it be fixed at your place?', label: 'Service', options: ['Come to me', 'I can drop it at a shop', 'Pick up and drop back'] },
    ],
    bullets: ['Check the device and confirm the cost before repairing', 'Don’t access personal data beyond what the repair needs', 'Use good-quality replacement parts', 'Show it working before handing it back'],
    skills: ['device_repair', 'troubleshooting'],
    budget: [300, 3000],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'carpentry',
    category: 'Home Services',
    noun: 'carpentry work',
    strong: /\b(carpenter|carpentry|furniture|assemble|assembly|ikea|wardrobe|almirah|cupboard|door (lock|hinge|repair)|hinge|drawer|bed frame|table repair|chair repair|curtain rod|shelf|shelves|wall mount|drill|tv mount)\b/,
    weak: /\b(install|fix|repair|wood|wooden)\b/,
    asks: [
      { question: 'What carpentry work is it?', label: 'Work', options: [x('Assemble new furniture', 1), x('Repair furniture or a door', 1), x('Drill and mount (TV, shelf, curtain rod)', 0.7), x('Make something custom', 3)] },
      { question: 'How many items?', label: 'Quantity', options: [x('Just one', 1), x('2–3', 1.8), x('4 or more', 2.8)] },
      { question: 'Who brings the materials?', label: 'Materials', options: ['Carpenter brings everything', 'I have the materials', 'Discuss first'] },
      WHERE_HOME,
    ],
    bullets: ['Confirm the work and materials before starting', 'Bring a drill and all needed tools', 'Protect walls and floors while working', 'Clean up the sawdust and packaging'],
    skills: ['carpentry'],
    budget: [300, 1500],
    difficulty: 'medium',
    onSite: true,
    care: 'home',
  },
  // ------------------------------------------------------- home services --
  {
    key: 'cleaning',
    category: 'Home Services',
    noun: 'cleaning',
    strong: /\b(clean|cleaning|cleaner|deep clean|deep cleaning|housekeeping|dusting|mopping|sweeping|bathroom cleaning|kitchen cleaning|sofa cleaning|carpet cleaning|move[- ]in clean|move[- ]out clean|maid|house help|bai|cobwebs)\b/,
    asks: [
      { question: 'What kind of cleaning?', label: 'Type', options: [x('Regular cleaning', 1), x('Deep cleaning', 2), x('Only kitchen', 0.8), x('Only bathrooms', 0.7), x('Sofa or carpet', 0.9), x('Move-in / move-out', 2.2)], skipIf: /\b(deep clean|deep cleaning|sofa|carpet|move[- ]in|move[- ]out)\b/ },
      SIZE,
      { question: 'Who brings the cleaning supplies?', label: 'Supplies', options: ['Cleaner brings everything', 'I have supplies', 'Discuss first'] },
      { question: 'How often?', label: 'Frequency', options: ['Just once', 'Every week', 'Every day'], skipIf: REGULAR },
    ],
    bullets: ['Confirm what’s included before starting', 'Use safe cleaning products', 'Take care with fragile items', 'Share before-and-after photos'],
    skills: ['cleaning', 'home_service'],
    budget: [400, 1500],
    difficulty: 'easy',
    onSite: true,
    care: 'home',
  },
  {
    key: 'painting',
    category: 'Home Services',
    noun: 'painting',
    strong: /\b(paint|painting|painter|repaint|wall putty|putty|texture|waterproofing|damp wall|wall stain)\b/,
    asks: [
      { question: 'What needs painting?', label: 'Area', options: [x('One wall', 0.4), x('One room', 1), x('Full flat', 3.5), x('Doors, grills or furniture', 0.6), x('Outside walls', 3)], skipIf: /\b(wall|walls|room|bedroom|flat|house|home|door|doors|grill|grills|furniture|outside|exterior)\b/ },
      { question: 'Who buys the paint?', label: 'Paint', options: ['Painter buys it (add to the quote)', 'I’ll buy it', 'Discuss first'] },
      { question: 'Any wall repairs first?', label: 'Prep', options: ['No, walls are fine', x('Some cracks or putty', 1.3), x('Damp or seepage', 1.6)] },
      WHERE_HOME,
    ],
    bullets: ['Cover furniture and floors before painting', 'Fill cracks and sand walls first', 'Use the agreed brand and shade', 'Clean up paint marks when done'],
    skills: ['painting', 'home_service'],
    budget: [1500, 6000],
    difficulty: 'medium',
    onSite: true,
    care: 'home',
  },
  {
    key: 'pest',
    category: 'Home Services',
    noun: 'pest control',
    strong: /\b(pest|pest control|cockroach|termite|bed ?bugs?|rats?|mice|mosquito|ants|lizard|fumigation)\b/,
    asks: [
      { question: 'Which pests?', label: 'Pests', options: ['Cockroaches', x('Termites', 2), x('Bed bugs', 1.8), 'Rats or mice', 'Mosquitoes or ants'], skipIf: /\b(cockroach|termite|bed ?bug|rat|mice|mosquito|ant)\b/ },
      SIZE,
      { question: 'Any kids, pets or elderly at home?', label: 'At home', options: ['No', 'Yes — need safe, odourless treatment'] },
    ],
    bullets: ['Explain the chemicals used and safety steps', 'Tell me how long to stay out after treatment', 'Treat kitchen, bathrooms and hidden corners', 'Offer a follow-up visit if pests come back'],
    skills: ['pest_control'],
    budget: [800, 2500],
    difficulty: 'medium',
    onSite: true,
    care: 'home',
  },
  {
    key: 'moving',
    category: 'Home Services',
    noun: 'help with moving',
    strong: /\b(shift|shifting|move house|moving house|relocate|relocation|packers|movers|packing|unpacking|loading|unloading|tempo|mini truck)\b/,
    weak: /\b(move|moving|heavy|lift)\b/,
    asks: [
      { question: 'What are you moving?', label: 'Moving', options: [x('A few items', 0.5), x('1 BHK', 1), x('2 BHK', 1.6), x('3 BHK or more', 2.4), x('Office', 2)], skipIf: /\b\d ?bhk\b/ },
      { question: 'How far is the new place?', label: 'Distance', options: [x('Same building or street', 0.6), x('Within the city', 1), x('Another city', 3)] },
      { question: 'What help is needed?', label: 'Help', options: [x('Just carrying', 0.6), x('Packing and moving', 1), x('Packing, moving and unpacking', 1.4), x('Vehicle + labour', 1.3)] },
      { question: 'Is there a lift?', label: 'Lift', options: ['Yes, at both places', x('No lift — stairs', 1.2), 'Ground floor'] },
    ],
    bullets: ['Bring packing material and bubble wrap', 'Label boxes room by room', 'Handle fragile items with extra care', 'Place furniture where asked at the new home'],
    skills: ['moving', 'labour'],
    budget: [1500, 6000],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'cook',
    category: 'Home Services',
    noun: 'a cook',
    strong: /\b(cook|cooking|chef|cook food|meals?|tiffin|lunch box|dinner for|party food|roti|chapati)\b/,
    asks: [
      { question: 'Which meals?', label: 'Meals', options: ['Breakfast', 'Lunch', 'Dinner', x('All meals', 2.2), x('One-time party', 2.5)], skipIf: /\b(breakfast|lunch|dinner|all meals|party)\b/ },
      { question: 'How many people?', label: 'People', options: [x('1–2', 1), x('3–5', 1.4), x('6–10', 2), x('More than 10', 3)], skipIf: /\b\d+ (people|persons|members|family members)\b/ },
      { question: 'What food?', label: 'Food', options: ['North Indian', 'South Indian', 'Jain or no onion-garlic', 'Non-veg too', 'Anything simple'] },
      { question: 'How often?', label: 'Frequency', options: ['Just once', 'Every day', 'A few days a week'], skipIf: REGULAR },
    ],
    bullets: ['Keep the kitchen clean while cooking', 'Follow the diet and spice preferences shared', 'Use ingredients I provide unless agreed otherwise', 'Clean the kitchen counter after cooking'],
    skills: ['cooking'],
    budget: [300, 1200],
    difficulty: 'easy',
    onSite: true,
    care: 'home',
  },
  {
    key: 'laundry',
    category: 'Home Services',
    noun: 'laundry and ironing',
    strong: /\b(laundry|wash clothes|washing clothes|ironing|iron my|dry clean|dry cleaning|fold clothes|laundry clothes)\b/,
    asks: [
      { question: 'What needs doing?', label: 'Service', options: ['Washing and drying', x('Ironing only', 0.6), 'Wash and iron', x('Dry cleaning', 1.8)] },
      { question: 'How many clothes?', label: 'Quantity', options: [x('Under 10', 0.6), x('10–30', 1), x('30+', 1.8)] },
      { question: 'Pick-up and drop?', label: 'Pick-up', options: ['Yes, pick up and drop back', 'I’ll drop them off', 'Do it at my home'] },
    ],
    bullets: ['Check pockets and sort colours before washing', 'Follow fabric care labels', 'Return everything neatly folded', 'Count items at pick-up and drop'],
    skills: ['laundry'],
    budget: [150, 600],
    difficulty: 'easy',
    onSite: true,
  },
  {
    key: 'garden',
    category: 'Home Services',
    noun: 'gardening',
    strong: /\b(garden|gardener|gardening|plants?|lawn|grass cutting|mow|pruning|potting|repotting|terrace garden|balcony garden|watering plants|garden plants)\b/,
    asks: [
      { question: 'What garden work?', label: 'Work', options: ['Water and care for plants', x('Trim, prune or weed', 1.2), x('Repot or plant new', 1.3), x('Set up a new garden', 3), x('Lawn mowing', 1.2)] },
      { question: 'How big is it?', label: 'Size', options: [x('A few pots', 0.6), x('Balcony', 1), x('Terrace', 1.6), x('Lawn or yard', 2)] },
      { question: 'How often?', label: 'Frequency', options: ['Just once', 'Every week', 'While I’m away'], skipIf: REGULAR },
      WHERE_HOME,
    ],
    bullets: ['Check soil and plant health first', 'Bring basic gardening tools', 'Clear away trimmed leaves and soil', 'Share photos of the plants after'],
    skills: ['gardening'],
    budget: [300, 1200],
    difficulty: 'easy',
    onSite: true,
  },
  {
    key: 'tailor',
    category: 'Home Services',
    noun: 'tailoring',
    strong: /\b(tailor|tailoring|stitch|stitching|alteration|alter my|blouse|kurti|hemming|fitting|sew|sewing)\b/,
    asks: [
      { question: 'What tailoring work?', label: 'Work', options: [x('Alteration or fitting', 0.6), x('Stitch a new outfit', 2), x('Blouse stitching', 1.5), x('Small repair', 0.4)] },
      { question: 'How many pieces?', label: 'Quantity', options: [x('1', 1), x('2–3', 2), x('4 or more', 3)] },
      { question: 'Pick-up and drop?', label: 'Pick-up', options: ['Yes, pick up and drop back', 'I’ll bring them', 'Take measurements at my home'] },
    ],
    bullets: ['Take accurate measurements or use a sample piece', 'Confirm the design before cutting fabric', 'Deliver by the agreed date', 'Fix any fitting issue for free'],
    skills: ['tailoring'],
    budget: [200, 1500],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'beauty',
    category: 'Home Services',
    noun: 'a beauty professional at home',
    strong: /\b(salon|parlour|parlor|haircut|hair cut|facial|waxing|threading|manicure|pedicure|makeup|make-up|mehndi|mehendi|massage|bridal makeup|hair colour|hair color|spa)\b/,
    asks: [
      { question: 'Which service?', label: 'Service', options: [x('Haircut', 0.6), x('Facial or cleanup', 1), x('Waxing or threading', 0.8), x('Party makeup', 2.5), x('Bridal makeup', 8), x('Mehndi', 1.5)], skipIf: /\b(haircut|hair cut|facial|waxing|threading|bridal|mehndi|mehendi)\b/ },
      { question: 'For how many people?', label: 'People', options: [x('Just me', 1), x('2–3', 2.2), x('A group', 4)] },
      { question: 'Who should come?', label: 'Preference', options: ['Female professional', 'Male professional', 'No preference'] },
    ],
    bullets: ['Bring sanitised tools and fresh disposables', 'Use branded products and share which ones', 'Do a patch test for new products', 'Leave the area clean after'],
    skills: ['beauty', 'home_service'],
    budget: [400, 2000],
    difficulty: 'easy',
    onSite: true,
    care: 'home',
  },
  {
    key: 'pet',
    category: 'Home Services',
    noun: 'pet care',
    strong: /\b(dog|cat|pet|pets|dog walk|dog walker|walk my dog|pet sitter|pet sitting|pet grooming|grooming|feed my (dog|cat)|vet visit|kennel)\b/,
    asks: [
      { question: 'What does your pet need?', label: 'Service', options: ['Walks', x('Feeding while I’m away', 1), x('Pet sitting', 1.5), x('Grooming or bath', 1.4), x('Vet visit', 1.2)], skipIf: /\b(walk|walker|groom|grooming|vet|sitting|sitter|feed)\b/ },
      { question: 'Which pet?', label: 'Pet', options: ['Small dog', 'Large dog', 'Cat', 'More than one pet'], skipIf: /\b(cat|small dog|large dog|big dog)\b/ },
      { question: 'How long each time?', label: 'Duration', options: [x('30 minutes', 0.7), x('1 hour', 1), x('A few hours', 2), x('Overnight', 3.5)] },
      { question: 'How often?', label: 'Frequency', options: ['Just once', 'Every day', 'A few days a week', 'While I’m travelling'], skipIf: REGULAR },
    ],
    bullets: ['Meet the pet briefly before the first visit', 'Follow feeding and leash instructions exactly', 'Send a photo or short update each visit', 'Call me straight away if the pet seems unwell'],
    skills: ['pet_care'],
    budget: [200, 800],
    difficulty: 'easy',
    onSite: true,
    care: 'pet',
  },
  {
    key: 'child',
    category: 'Home Services',
    noun: 'childcare',
    strong: /\b(babysit|babysitter|babysitting|nanny|child ?care|look after (my )?(child|son|daughter)|take care of (my )?(child|son|daughter)|school pick ?up|child)\b/,
    asks: [
      { question: 'How old is the child?', label: 'Age', options: ['Under 2', '2–5 years', '6–12 years', 'More than one child'], skipIf: /\b\d+ ?(year|yr|month)s?[- ]old\b/ },
      { question: 'What help is needed?', label: 'Help', options: ['Babysitting at home', 'School pick-up and drop', 'Homework help', 'Play and supervise'] },
      { question: 'For how long?', label: 'Duration', options: [x('A few hours', 1), x('Half day', 2), x('Full day', 3.5), x('Evenings', 1.5)] },
      { question: 'How often?', label: 'Frequency', options: ['Just once', 'Every weekday', 'Occasionally'], skipIf: REGULAR },
    ],
    bullets: ['Have prior childcare experience', 'Follow the routine, food and screen-time rules shared', 'Never leave the child alone', 'Send updates and call me for anything unusual'],
    skills: ['childcare'],
    budget: [400, 1500],
    difficulty: 'medium',
    onSite: true,
    care: 'child',
  },
  {
    key: 'elder',
    category: 'Home Services',
    noun: 'elder care',
    strong: /\b(elder|elder care|caretaker|caregiver|attendant|patient care|old age|companion for|hospital visit|doctor visit|medicine reminder|nursing)\b/,
    asks: [
      { question: 'What help is needed?', label: 'Help', options: ['Company and conversation', 'Doctor or hospital visit', 'Daily care and medicines', x('Nursing care', 2)] },
      { question: 'Can they move around on their own?', label: 'Mobility', options: ['Yes, independently', 'With some support', x('Mostly bed-bound', 1.5)] },
      { question: 'For how long?', label: 'Duration', options: [x('A few hours', 1), x('Half day', 2), x('Full day', 3.5), x('Overnight', 3)] },
      { question: 'How often?', label: 'Frequency', options: ['Just once', 'Every day', 'A few days a week'], skipIf: REGULAR },
    ],
    bullets: ['Be patient, kind and respectful', 'Follow medicine timings and doctor instructions exactly', 'Share a short update after every visit', 'Call family straight away in an emergency'],
    skills: ['elder_care'],
    budget: [500, 1500],
    difficulty: 'medium',
    onSite: true,
    care: 'elder',
  },
  {
    key: 'driver',
    category: 'Errands & Delivery',
    noun: 'a driver',
    strong: /\b(driver|drive my car|chauffeur|drop me|pick me up|airport (drop|pickup|pick up)|outstation)\b/,
    asks: [
      { question: 'What kind of trip?', label: 'Trip', options: [x('In the city, a few hours', 1), x('Airport or station drop', 0.8), x('Full day', 2), x('Outstation', 3.5)] },
      { question: 'Whose car?', label: 'Car', options: ['My car — need a driver only', x('Driver brings the car', 2)] },
      { question: 'Manual or automatic?', label: 'Gearbox', options: ['Manual', 'Automatic', 'Either'] },
    ],
    bullets: ['Have a valid driving licence and share it', 'Arrive on time', 'Drive safely and follow traffic rules', 'Fuel, toll and parking costs as agreed in chat'],
    skills: ['driving'],
    budget: [500, 1500],
    difficulty: 'easy',
    onSite: false,
  },
  // --------------------------------------------------- errands & delivery --
  {
    key: 'delivery',
    category: 'Errands & Delivery',
    noun: 'a pick-up and drop',
    strong: /\b(deliver|delivery|pick ?up|courier|parcel|package|drop off|drop it|send it|collect from|bring (it|me|from)|fetch)\b/,
    weak: /\b(drop|send|collect|errand)\b/,
    asks: [
      { question: 'What’s being moved?', label: 'Item', options: [x('Documents or keys', 0.8), x('A small parcel', 1), x('Groceries or shopping', 1.2), x('Something big or heavy', 2)] },
      { question: 'How far is it?', label: 'Distance', options: [x('Within 2 km', 0.7), x('2–10 km', 1.2), x('Across the city', 2)] },
      { question: 'What proof do you want?', label: 'Proof', options: ['Photo on delivery', 'Signature or OTP', 'Just a message'] },
    ],
    bullets: ['Pick up from the place shared in chat', 'Keep the item safe, dry and unopened', 'Deliver to the right person only', 'Send a photo once delivered'],
    skills: ['delivery', 'errands'],
    budget: [100, 400],
    difficulty: 'easy',
    onSite: false,
  },
  {
    key: 'queue',
    category: 'Errands & Delivery',
    noun: 'help with an errand',
    strong: /\b(stand in (the )?(line|queue)|queue|token|bank work|post office|pay (my )?(bill|bills)|bill payment|submit (the )?(documents|form)|government office|rto|passport office|collect (my )?(certificate|documents))\b/,
    weak: /\b(errand|office|bank|bill)\b/,
    asks: [
      { question: 'What’s the errand?', label: 'Errand', options: ['Stand in a queue', 'Bank or post office work', 'Submit or collect documents', 'Pay a bill in person'] },
      { question: 'How long might it take?', label: 'Time', options: [x('Under an hour', 1), x('1–3 hours', 2), x('Half a day', 3.5)] },
      { question: 'Do they need anything from you?', label: 'Needs', options: ['An authority letter', 'Documents or copies', 'Money to pay', 'Nothing'] },
    ],
    bullets: ['Go at the time agreed in chat', 'Keep documents and money safe', 'Share the receipt or token photo', 'Send a quick update when done'],
    skills: ['errands'],
    budget: [200, 600],
    difficulty: 'easy',
    onSite: false,
  },
  // -------------------------------------------------- shopping & sourcing --
  {
    key: 'buy',
    category: 'Shopping & Sourcing',
    noun: 'help with shopping',
    strong: /\b(buy|purchase|get me|bring me|grocery|groceries|vegetables|medicines?|pharmacy|shopping for|order (some|a))\b/,
    weak: /\b(market|store|shop|items|need some)\b/,
    asks: [
      { question: 'What should they buy?', label: 'Buying', options: [x('Groceries or vegetables', 1), x('Medicines', 0.8), x('A specific product', 1.2), x('Gifts', 1.3)] },
      { question: 'How many items?', label: 'Items', options: [x('1–3 items', 0.7), x('A short list', 1), x('A big list', 1.6)] },
      { question: 'How will you pay for the items?', label: 'Payment', options: ['Pay them back on the bill', 'Send money first', 'Pay the shop directly'] },
    ],
    bullets: ['Buy exactly what’s on the list', 'Ask before swapping a brand or item', 'Check expiry dates and condition', 'Share the bill and hand over the change'],
    skills: ['shopping', 'errands'],
    budget: [100, 400],
    difficulty: 'easy',
    onSite: false,
  },
  {
    key: 'source',
    category: 'Shopping & Sourcing',
    noun: 'price comparison',
    strong: /\b(find (me )?(a |the )?(shop|shops|store|seller|supplier|vendor)|price check|compare prices|best price|cheapest|where can i (buy|get)|second hand|used (bike|car|phone|laptop|furniture)|supplier|wholesale|bulk)\b/,
    weak: /\b(find|price|source|looking for|available|cheap)\b/,
    asks: [
      { question: 'What do you need found?', label: 'Item', options: ['A product', 'A shop or service', 'A second-hand item', x('A bulk supplier', 1.6)] },
      { question: 'New or used?', label: 'Condition', options: ['New only', 'Used is fine', 'Either'], skipIf: /\b(new|used|second hand|refurbished)\b/ },
      { question: 'How many options?', label: 'Options', options: [x('The best one', 0.8), x('Top 3', 1), x('5 or more', 1.5)] },
      { question: 'What should they send?', label: 'Report', options: ['Prices and contacts', 'Photos of each option', 'Buy the best one for me'] },
    ],
    bullets: ['Compare at least three sellers', 'Share photos, prices and seller contacts', 'Check condition and warranty', 'Don’t pay anything without my okay'],
    skills: ['sourcing', 'price_comparison'],
    budget: [200, 800],
    difficulty: 'easy',
    onSite: false,
  },
  // --------------------------------------------------- local checks & info --
  {
    key: 'property',
    category: 'Local Checks & Info',
    noun: 'a property visit',
    strong: /\b(flat|apartment|pg|hostel|room for rent|house for rent|property|site visit|plot|before i rent|before renting|rental)\b/,
    weak: /\b(visit|check|rent|photos|video)\b/,
    asks: [
      { question: 'What should they check?', label: 'Check', options: ['Photos and video tour', 'Water, power and network', 'Talk to the owner or neighbours', 'All of it'] },
      { question: 'How many places?', label: 'Places', options: [x('1', 1), x('2–3', 2), x('4 or more', 3)] },
      { question: 'How should they report back?', label: 'Report', options: ['Photos and notes', 'Live video call', 'Recorded video'] },
    ],
    bullets: ['Visit in person at the time agreed', 'Video every room, plus the building and street', 'Check water, power, network and parking', 'Send honest notes on condition and the area'],
    skills: ['local_intel', 'field_check'],
    budget: [300, 800],
    difficulty: 'easy',
    onSite: false,
  },
  {
    key: 'check',
    category: 'Local Checks & Info',
    noun: 'an on-the-spot check',
    strong: /\b(check (if|whether)|see if|is it open|confirm (if|whether)|verify|inspect|go and check|visit (the|a|this) (place|shop|office)|on the spot|ground report|mystery shop)\b/,
    weak: /\b(check|visit|confirm|photos of)\b/,
    asks: [
      { question: 'What should they find out?', label: 'Check', options: ['Is it open or available?', 'Condition of something', 'Prices or details', 'Ask someone a question'] },
      { question: 'How should they report back?', label: 'Report', options: ['Photos with notes', 'Short video', 'Call me from there'] },
      { question: 'How soon?', label: 'When', options: [x('Today', 1.3), 'In 2–3 days', 'This week'], skipIf: URGENT },
    ],
    bullets: ['Go to the exact place shared in chat', 'Take clear, timestamped photos', 'Answer each question asked', 'Report only what was seen first-hand'],
    skills: ['local_intel', 'field_check'],
    budget: [150, 500],
    difficulty: 'easy',
    onSite: false,
  },
  {
    key: 'survey',
    category: 'Local Checks & Info',
    noun: 'opinions from real people',
    strong: /\b(survey|ask (\d+ )?people|opinions?|feedback from|poll|which (one|option) (do )?(people|they) prefer|market research|questionnaire|sign ?ups?)\b/,
    asks: [
      { question: 'How many people?', label: 'People', options: [x('10', 0.6), x('25', 1), x('50', 1.8), x('100+', 3)], skipIf: /\b\d+ (people|persons|responses|signups|sign ups)\b/ },
      { question: 'Who should they ask?', label: 'Audience', options: ['Anyone', 'Students', 'Working people', 'Shop owners', 'Parents'] },
      { question: 'How should answers be collected?', label: 'Method', options: ['In person', 'Phone calls', 'Online form'] },
    ],
    bullets: ['Ask real people, no fake answers', 'Use the questions shared in chat', 'Share results in a sheet with names or proof', 'Add a short summary of what you heard'],
    skills: ['research', 'local_intel'],
    budget: [300, 1500],
    difficulty: 'easy',
    onSite: false,
  },
  // ------------------------------------------------------ tech & websites --
  {
    key: 'website',
    category: 'Tech & Websites',
    noun: 'website work',
    strong: /\b(website|web site|landing page|wordpress|shopify|wix|webflow|portfolio site|portfolio website|domain|hosting|seo|web page|online store|e-?commerce site)\b/,
    weak: /\b(site|page|bug|online)\b/,
    asks: [
      { question: 'What’s the website work?', label: 'Work', options: [x('Fix a problem', 0.6), x('Build a new website', 3), x('Change or add pages', 1), x('Set up domain or hosting', 0.6), x('SEO or speed', 1.2)] },
      { question: 'What is it built on?', label: 'Platform', options: ['WordPress', 'Shopify', 'Wix or Squarespace', 'Custom code', 'Nothing yet'], skipIf: /\b(wordpress|shopify|wix|webflow|squarespace|react|next)\b/ },
      { question: 'How many pages?', label: 'Pages', options: [x('1 page', 0.7), x('2–5 pages', 1), x('6+ pages or a store', 2.2)] },
    ],
    bullets: ['Confirm the scope and timeline before starting', 'Work on a backup or staging copy first', 'Make sure it works on mobile', 'Hand over logins and a short guide'],
    skills: ['web_development'],
    budget: [1000, 8000],
    difficulty: 'hard',
    onSite: false,
  },
  {
    key: 'app',
    category: 'Tech & Websites',
    noun: 'app development',
    strong: /\b(mobile app|android app|ios app|build an app|make an app|app development|flutter|react native|apk|app bug)\b/,
    asks: [
      { question: 'What’s the app work?', label: 'Work', options: [x('Fix a bug', 0.4), x('Add a feature', 1), x('Build a new app', 4), x('Publish to Play Store / App Store', 0.5)] },
      { question: 'Which platforms?', label: 'Platform', options: ['Android', 'iPhone', x('Both', 1.5)] },
      { question: 'Do you have designs?', label: 'Designs', options: ['Yes, ready', 'Rough sketch', x('No, need design too', 1.4)] },
    ],
    bullets: ['Confirm features and milestones before starting', 'Share progress builds to test', 'Keep the code in my repository', 'Hand over source code and setup steps'],
    skills: ['app_development'],
    budget: [3000, 25000],
    difficulty: 'hard',
    onSite: false,
  },
  {
    key: 'sheets',
    category: 'Tech & Websites',
    noun: 'Excel or Sheets work',
    strong: /\b(excel|spreadsheet|google sheets?|formula|formulas|vlookup|pivot|macro|dashboard|tally)\b/,
    asks: [
      { question: 'What do you need in the sheet?', label: 'Work', options: ['Formulas or fixes', x('A dashboard or report', 1.6), x('Automate with macros', 2), x('Clean up data', 0.8)] },
      { question: 'How much data?', label: 'Data', options: [x('Under 500 rows', 0.8), x('500–5,000 rows', 1), x('Bigger', 1.6)] },
      { question: 'Excel or Google Sheets?', label: 'Tool', options: ['Excel', 'Google Sheets', 'Either'], skipIf: /\b(excel|google sheets?)\b/ },
    ],
    bullets: ['Work on a copy, never the only original', 'Explain the formulas used', 'Check results with sample numbers', 'Deliver the finished file with short notes'],
    skills: ['excel', 'data'],
    budget: [400, 3000],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'techhelp',
    category: 'Tech & Websites',
    noun: 'tech help',
    strong: /\b(wifi|internet (not working|slow|setup)|smart tv|set ?up (my )?(tv|printer|laptop|phone|alexa|cctv)|cctv|camera install|software install|install (windows|software|antivirus)|email setup|transfer data|backup my|smart home)\b/,
    weak: /\b(setup|set up|install|tech|computer|software)\b/,
    asks: [
      { question: 'What needs setting up or fixing?', label: 'Device', options: ['Wi-Fi or internet', 'TV or streaming', 'Printer', 'Laptop software', x('CCTV cameras', 2)] },
      { question: 'Remote or in person?', label: 'Mode', options: ['Remote is fine', 'Must come in person'], skipIf: REMOTE_OK },
      { question: 'How many devices?', label: 'Quantity', options: [x('1', 1), x('2–3', 1.6), x('4 or more', 2.4)] },
    ],
    bullets: ['Explain each step in simple words', 'Don’t change passwords without telling me', 'Test everything before leaving', 'Write down any logins created'],
    skills: ['tech_support'],
    budget: [300, 1500],
    difficulty: 'medium',
    onSite: false,
  },
  // ---------------------------------------------------- design & creative --
  {
    key: 'design',
    category: 'Design & Creative',
    noun: 'design work',
    strong: /\b(logo|graphic design|poster|banner|flyer|brochure|visiting card|business card|menu card|invitation card|thumbnail|instagram post design|canva|illustration|brand identity|packaging design|label design)\b/,
    weak: /\b(design|designer|creative|artwork)\b/,
    asks: [
      { question: 'What should be designed?', label: 'Design', options: [x('Logo', 1.2), x('Social media posts', 1), x('Poster, flyer or banner', 0.8), x('Visiting card or invitation', 0.6), x('Full brand kit', 3)], skipIf: /\b(logo|poster|banner|flyer|brochure|card|thumbnail|illustration|packaging)\b/ },
      { question: 'What style do you like?', label: 'Style', options: ['Minimal and clean', 'Bold and colourful', 'Match my brand', 'Show me options'] },
      { question: 'How many revisions?', label: 'Revisions', options: [x('1 round', 0.8), x('2 rounds', 1), x('Until I’m happy', 1.4)] },
    ],
    bullets: ['Share a first draft for feedback', 'Include the agreed revision rounds', 'Deliver print and web sizes', 'Hand over editable source files'],
    skills: ['graphic_design'],
    budget: [500, 3000],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'videoedit',
    category: 'Design & Creative',
    noun: 'video editing',
    strong: /\b(edit (my )?(video|footage|reel|clips)|video edit|video editing|reel edit|reels? editing|youtube edit|cut the video|subtitles|captions on video|premiere|capcut)\b/,
    weak: /\b(edit|editing|reel|reels|footage)\b/,
    asks: [
      { question: 'What’s the video for?', label: 'For', options: ['Instagram reel or Short', 'YouTube video', 'Event highlights', 'Ad or promo'] },
      { question: 'How long is the final video?', label: 'Length', options: [x('Under 1 minute', 0.7), x('1–5 minutes', 1), x('5–15 minutes', 1.8), x('Longer', 3)] },
      { question: 'What should be added?', label: 'Extras', options: ['Music and cuts', 'Captions or subtitles', x('Motion graphics', 1.5), 'Colour correction'] },
    ],
    bullets: ['Share a first cut for feedback', 'Use copyright-free music', 'Export in the right size for the platform', 'Include one round of changes'],
    skills: ['video_editing'],
    budget: [500, 3000],
    difficulty: 'medium',
    onSite: false,
  },
  // --------------------------------------------------- writing & content --
  {
    key: 'writing',
    category: 'Writing & Content',
    noun: 'writing',
    strong: /\b(write|writing|writer|content|blog|article|caption|captions|copywriting|product description|script|speech|essay|statement of purpose|sop|proofread|proofreading|edit my (essay|article|document))\b/,
    asks: [
      { question: 'What should be written?', label: 'Writing', options: ['Social media captions', 'Blog or article', 'Website or product copy', 'Script or speech', 'Proofreading only'], skipIf: /\b(blog|article|caption|script|speech|essay|sop|proofread|product description)\b/ },
      { question: 'How long?', label: 'Length', options: [x('Under 300 words', 0.6), x('300–1,000 words', 1), x('1,000+ words', 2)] },
      { question: 'Which language?', label: 'Language', options: ['English', 'Hindi', 'Hinglish', 'Another language'] },
      { question: 'What tone?', label: 'Tone', options: ['Professional', 'Friendly', 'Funny', 'Persuasive'] },
    ],
    bullets: ['Write original content — no copying or AI dumps', 'Match the tone and audience shared in chat', 'Include one round of edits', 'Deliver as an editable document'],
    skills: ['content_writing'],
    budget: [300, 2000],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'translate',
    category: 'Writing & Content',
    noun: 'translation',
    strong: /\b(translate|translation|translator|transcribe|transcription|subtitle file|interpret)\b/,
    asks: [
      { question: 'From which language to which?', label: 'Languages', options: ['English → Hindi', 'Hindi → English', 'English → a regional language', 'Another pair'], skipIf: /\b(english|hindi|tamil|telugu|marathi|bengali|kannada|malayalam|gujarati|punjabi|urdu|odia|french|german|spanish|arabic|japanese) (to|into) (english|hindi|tamil|telugu|marathi|bengali|kannada|malayalam|gujarati|punjabi|urdu|odia|french|german|spanish|arabic|japanese)\b/ },
      { question: 'What is it?', label: 'Material', options: ['Document', 'Website or app text', 'Audio or video', 'Live interpreting'] },
      { question: 'How much?', label: 'Amount', options: [x('1–2 pages or 5 min', 0.6), x('3–10 pages or 30 min', 1), x('More', 2.5)] },
    ],
    bullets: ['Translate the meaning, not word for word', 'Keep names, numbers and formatting intact', 'Use a native speaker for the target language', 'Deliver an editable file'],
    skills: ['translation'],
    budget: [300, 2000],
    difficulty: 'medium',
    onSite: false,
  },
  // ------------------------------------------------------- photo & video --
  {
    key: 'photo',
    category: 'Photo & Video',
    noun: 'a photographer',
    strong: /\b(photographer|photography|photo ?shoot|shoot photos|product photos?|headshots?|portraits?|videographer|videography|shoot (a )?video|drone shot|pre-?wedding shoot|maternity shoot)\b/,
    weak: /\b(photos?|shoot|camera|video)\b/,
    asks: [
      { question: 'What’s the shoot for?', label: 'Shoot', options: ['Product photos', 'Portraits or headshots', x('Wedding or event', 2.5), 'Social media reel', x('Pre-wedding shoot', 2)], skipIf: /\b(wedding|pre-?wedding|product|portrait|portraits|headshots?|event|birthday|party|reel|maternity|engagement)\b/ },
      { question: 'Photos, video or both?', label: 'Media', options: ['Photos', 'Video', x('Both', 1.6)] },
      { question: 'How long is the shoot?', label: 'Duration', options: [x('Under an hour', 0.6), x('1–3 hours', 1), x('Half day', 1.8), x('Full day', 3)] },
      { question: 'Do you need editing?', label: 'Editing', options: ['Yes, edited files', x('Raw files are fine', 0.8)] },
    ],
    bullets: ['Bring your own camera and lighting', 'Agree the shot list in chat beforehand', 'Deliver edited files within the agreed time', 'Share everything through a download link'],
    skills: ['photography', 'video'],
    budget: [1500, 6000],
    difficulty: 'medium',
    onSite: true,
  },
  // ------------------------------------------------- tutoring & education --
  {
    key: 'tutor',
    category: 'Tutoring & Education',
    noun: 'a tutor',
    strong: /\b(tutor|teacher|teach|tuition|homework|maths|math|physics|chemistry|biology|science|accounts|economics|exam prep|exam preparation|board exam|jee|neet|upsc|cat exam|gre|ielts|toefl|coding class|spoken english|english speaking)\b/,
    weak: /\b(learn|class|classes|lesson|study|exam|revision|subject)\b/,
    asks: [
      { question: 'Which level?', label: 'Level', options: ['Primary school', 'Classes 6–10', 'Classes 11–12', x('College', 1.3), x('Competitive exam', 1.6), 'Adult learner'], skipIf: /\b((class|grade|std|standard) ?\d+|college|university|jee|neet|upsc|cat exam|gre|ielts|toefl|board exam)\b/ },
      { question: 'Online or in person?', label: 'Mode', options: ['Online', 'At my home', 'Either'], skipIf: REMOTE_OK },
      { question: 'How many sessions?', label: 'Sessions', options: ['Just one', 'A few', 'Weekly, ongoing'], skipIf: REGULAR },
    ],
    bullets: ['Check the current level in the first session', 'Explain step by step with examples', 'Give practice questions after each session', 'Share progress with me regularly'],
    skills: ['tutoring'],
    budget: [300, 1000],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'coach',
    category: 'Tutoring & Education',
    noun: 'a coach',
    strong: /\b(yoga|gym|fitness|personal trainer|workout|zumba|dance|dancing|guitar|piano|keyboard|singing|music lessons?|swimming|cricket coach|chess|drawing class|painting class|art class|driving lessons?|learn to drive)\b/,
    asks: [
      { question: 'What would you like to learn?', label: 'Skill', options: ['Yoga or fitness', 'Dance', 'Music or an instrument', 'Sport', 'Art', 'Driving'], skipIf: /\b(yoga|gym|fitness|workout|zumba|dance|guitar|piano|keyboard|singing|music|swimming|cricket|chess|drawing|art|driving|drive)\b/ },
      { question: 'What’s your level?', label: 'Level', options: ['Complete beginner', 'Some experience', 'Advanced'] },
      { question: 'Online or in person?', label: 'Mode', options: ['Online', 'At my home', 'At a park or studio'], skipIf: REMOTE_OK },
      { question: 'How often?', label: 'Frequency', options: ['One session', 'Twice a week', 'Daily'], skipIf: REGULAR },
    ],
    bullets: ['Start with a short assessment', 'Plan sessions around my goal', 'Correct form and technique closely', 'Share practice tips between sessions'],
    skills: ['coaching'],
    budget: [400, 1200],
    difficulty: 'medium',
    onSite: false,
  },
  // ---------------------------------------------------- career & resume --
  {
    key: 'resume',
    category: 'Career & Resume',
    noun: 'resume help',
    strong: /\b(resume|linkedin profile|linkedin|cover letter|ats|portfolio review|job application)\b/,
    asks: [
      { question: 'What do you need?', label: 'Need', options: [x('Review with suggestions', 0.7), x('Rewrite my resume', 1.5), x('LinkedIn profile', 1), x('Cover letter', 0.7)] },
      { question: 'Which field?', label: 'Field', options: ['IT or software', 'Sales or marketing', 'Finance or accounts', 'Design or creative', 'Something else'] },
      { question: 'How much experience do you have?', label: 'Experience', options: ['Fresher', '1–3 years', '3–8 years', x('8+ years', 1.5)] },
    ],
    bullets: ['Review the documents shared in chat', 'Give specific, line-by-line fixes', 'Make it ATS-friendly with the right keywords', 'Deliver an editable final version'],
    skills: ['career_coaching', 'resume_writing'],
    budget: [300, 1500],
    difficulty: 'easy',
    onSite: false,
  },
  {
    key: 'career',
    category: 'Career & Resume',
    noun: 'career help',
    strong: /\b(referral|refer me|mock interview|interview prep|interview preparation|career advice|career guidance|placement|internship|switch careers?|salary negotiation|job search)\b/,
    weak: /\b(job|interview|career|hr)\b/,
    asks: [
      { question: 'What help do you need?', label: 'Need', options: ['An employee referral', 'Mock interview', 'Career advice', 'Job search help'], skipIf: /\b(referral|mock interview|interview prep)\b/ },
      { question: 'Which field?', label: 'Field', options: ['IT or software', 'Sales or marketing', 'Finance', 'Government jobs', 'Something else'] },
      { question: 'How should it happen?', label: 'Mode', options: ['Video call', 'Chat only', 'Meet in person'] },
    ],
    bullets: ['Understand my background and goal first', 'Give honest, specific feedback', 'Share clear next steps', 'Keep my details confidential'],
    skills: ['career_coaching'],
    budget: [300, 2000],
    difficulty: 'easy',
    onSite: false,
  },
  // ------------------------------------------------ business & consulting --
  {
    key: 'bizsetup',
    category: 'Business & Consulting',
    noun: 'business setup help',
    strong: /\b(gst|gst registration|company registration|register (my |a )?(company|business|firm)|msme|udyam|trade licen[cs]e|fssai|food licen[cs]e|trademark|startup india|business plan|pitch deck)\b/,
    weak: /\b(business|startup|licen[cs]e|registration|company)\b/,
    asks: [
      { question: 'What do you need?', label: 'Need', options: ['GST registration', 'Company or firm registration', 'A licence (FSSAI, trade…)', x('Business plan or pitch deck', 1.5), 'Trademark'] },
      { question: 'What stage is the business at?', label: 'Stage', options: ['Just an idea', 'Starting soon', 'Already running'] },
      { question: 'Do you have the documents ready?', label: 'Documents', options: ['Yes', 'Some of them', 'Need help knowing what’s needed'] },
    ],
    bullets: ['List every document needed upfront', 'Explain government fees separately from your fee', 'Share the application number once filed', 'Keep my documents private'],
    skills: ['business_consulting', 'compliance'],
    budget: [800, 4000],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'tax',
    category: 'Business & Consulting',
    noun: 'tax and accounts help',
    strong: /\b(tax return|tax filing|file (my )?taxes|income tax|gst return|gst filing|bookkeeping|accounting|accountant|ca help|chartered accountant|balance sheet|audit)\b/,
    asks: [
      { question: 'What do you need?', label: 'Need', options: ['File income tax return', x('GST returns', 1.2), x('Bookkeeping', 1.5), 'Tax advice'], skipIf: /\b(tax return|gst return|gst filing|bookkeeping|accounting)\b/ },
      { question: 'What’s your income type?', label: 'Income', options: ['Salary', 'Business or freelance', 'Salary + other income', 'Capital gains'] },
      { question: 'Who is it for?', label: 'For', options: ['Just me', 'Me and family', 'My business'] },
    ],
    bullets: ['Check all documents before filing', 'Explain deductions and refunds clearly', 'Share the acknowledgement after filing', 'Keep financial details confidential'],
    skills: ['accounting', 'tax'],
    budget: [500, 3000],
    difficulty: 'medium',
    onSite: false,
  },
  {
    key: 'marketing',
    category: 'Business & Consulting',
    noun: 'marketing help',
    strong: /\b(marketing|social media manager|manage my (instagram|page)|grow my (instagram|page|business)|followers|instagram growth|facebook ads|google ads|meta ads|ads campaign|digital marketing|promote my|promotion|content calendar)\b/,
    weak: /\b(instagram|facebook|youtube|brand|promote|sales)\b/,
    asks: [
      { question: 'What marketing help?', label: 'Need', options: ['Manage social media', x('Run paid ads', 1.5), 'Content calendar', 'Marketing plan', 'Google Business profile'] },
      { question: 'Which platform?', label: 'Platform', options: ['Instagram', 'Facebook', 'YouTube', 'Google', 'All of them'], skipIf: /\b(instagram|facebook|youtube|google)\b/ },
      { question: 'For how long?', label: 'Duration', options: [x('One-time setup', 1), x('One month', 2), x('Ongoing', 3)] },
    ],
    bullets: ['Understand my business and audience first', 'Share a plan before posting or spending', 'Report results weekly', 'Never buy fake followers'],
    skills: ['digital_marketing'],
    budget: [1000, 6000],
    difficulty: 'medium',
    onSite: false,
  },
  // ---------------------------------------------------- events & planning --
  {
    key: 'decor',
    category: 'Events & Planning',
    noun: 'event decoration',
    strong: /\b(decor|decoration|decorate|balloon|balloons|flower decoration|stage decoration|room decoration|surprise setup|birthday setup)\b/,
    asks: [
      { question: 'What’s the occasion?', label: 'Occasion', options: ['Birthday', 'Anniversary', x('Wedding function', 3), 'Baby shower', 'Office event'], skipIf: /\b(birthday|anniversary|wedding|baby shower|office)\b/ },
      { question: 'What kind of decoration?', label: 'Decoration', options: [x('Balloons', 0.8), x('Flowers', 1.5), x('Theme setup', 1.8), x('Lights', 1)] },
      { question: 'Where?', label: 'Venue', options: ['At home', 'Banquet or hall', 'Restaurant', 'Outdoors'], skipIf: PLACE },
    ],
    bullets: ['Share design ideas or photos before the day', 'Arrive early to finish setup on time', 'Bring all materials and tools', 'Remove decorations after if agreed'],
    skills: ['event_decor'],
    budget: [1000, 5000],
    difficulty: 'medium',
    onSite: true,
  },
  {
    key: 'event',
    category: 'Events & Planning',
    noun: 'event help',
    strong: /\b(wedding|birthday party|party|event|function|anniversary|reception|engagement|puja|pooja|catering|caterer|anchor|dj|event planner|event coordinator)\b/,
    asks: [
      { question: 'What’s the event?', label: 'Event', options: ['Birthday party', x('Wedding', 3), 'Puja or family function', 'Office event'], skipIf: /\b(birthday|wedding|puja|pooja|office|engagement|reception)\b/ },
      { question: 'How many guests?', label: 'Guests', options: [x('Under 20', 0.6), x('20–100', 1), x('100–300', 2), x('300+', 3.5)] },
      { question: 'What help do you need?', label: 'Help', options: ['Coordinate on the day', 'Find vendors', x('Catering', 2), 'DJ or anchor', x('Everything', 2.5)] },
    ],
    bullets: ['Confirm the plan and timeline a few days before', 'Coordinate vendors as agreed', 'Be there from setup to wrap-up', 'Share a cost breakdown upfront'],
    skills: ['event_planning'],
    budget: [2000, 15000],
    difficulty: 'medium',
    onSite: true,
  },
  // ---------------------------------------------------- admin & data entry --
  {
    key: 'govtform',
    category: 'Admin & Data Entry',
    noun: 'form and document help',
    strong: /\b(aadhaar|pan card|passport|voter id|driving licen[cs]e|ration card|birth certificate|income certificate|caste certificate|pf withdrawal|epf|scholarship form|government form|govt form|online application|apply for)\b/,
    weak: /\b(form|forms|application|certificate|documents?|apply)\b/,
    asks: [
      { question: 'Which document or form?', label: 'Document', options: ['Aadhaar', 'PAN', 'Passport', 'Driving licence', 'PF or scholarship', 'Another form'], skipIf: /\b(aadhaar|pan|passport|licen[cs]e|pf|epf|scholarship|voter|ration)\b/ },
      { question: 'What’s the work?', label: 'Work', options: ['New application', 'Update or correction', 'Check the status', 'Book an appointment'] },
      { question: 'Online or in person?', label: 'Mode', options: ['Online is fine', 'Visit the office with me', 'Visit the office for me'] },
    ],
    bullets: ['List the documents needed before starting', 'Fill everything exactly as in my documents', 'Share the application or reference number', 'Never keep copies of my documents after'],
    skills: ['documentation', 'admin'],
    budget: [200, 800],
    difficulty: 'easy',
    onSite: false,
  },
  {
    key: 'dataentry',
    category: 'Admin & Data Entry',
    noun: 'data entry',
    strong: /\b(data entry|typing|type (out|up)|digitise|digitize|pdf to excel|pdf to word|convert pdf|scan documents|organi[sz]e files|copy paste|virtual assistant|inbox|email management)\b/,
    weak: /\b(type|data|entries|pdf|files|admin)\b/,
    asks: [
      { question: 'What’s the work?', label: 'Work', options: ['Typing from images or PDFs', 'Enter data into a sheet', 'Organise files or emails', 'Virtual assistant tasks'] },
      { question: 'How much is there?', label: 'Amount', options: [x('A few pages', 0.5), x('Around 100 entries', 1), x('Hundreds of entries', 2.2), x('Ongoing work', 3)] },
      { question: 'What format do you want back?', label: 'Format', options: ['Excel or Sheets', 'Word or Docs', 'Whatever works'] },
    ],
    bullets: ['Work from the files shared in chat', 'Double-check every entry', 'Deliver in the format asked for', 'Keep all information private'],
    skills: ['data_entry'],
    budget: [300, 1500],
    difficulty: 'easy',
    onSite: false,
  },
  {
    key: 'call',
    category: 'Admin & Data Entry',
    noun: 'someone to make calls for me',
    strong: /\b(call (this|the|a|some|these)|make (a )?calls?|phone (them|the)|call on my behalf|follow up with|book an appointment|customer care|complaint (to|with))\b/,
    asks: [
      { question: 'What should the call achieve?', label: 'Goal', options: ['Get information', 'Book an appointment', 'Raise or follow up a complaint', 'Negotiate a price'] },
      { question: 'How many calls?', label: 'Calls', options: [x('1–2', 1), x('3–10', 2), x('More than 10', 3.5)] },
      { question: 'Which language?', label: 'Language', options: ['English', 'Hindi', 'A regional language', 'Any'] },
    ],
    bullets: ['Use the details shared in chat only', 'Be polite and to the point', 'Note who you spoke to and what was agreed', 'Send a short summary after each call'],
    skills: ['calling', 'admin'],
    budget: [150, 600],
    difficulty: 'easy',
    onSite: false,
  },
];

/** Anything that matches no topic: still a good post, with the basics. */
const FALLBACK: Topic = {
  key: 'other',
  category: 'Other',
  noun: 'help',
  strong: /$^/,
  asks: [
    { question: 'What kind of help is this?', label: 'Help', options: ['Hands-on work', 'Find or buy something', 'Check something in person', 'Online or computer work', 'Advice'] },
    { question: 'Where should it happen?', label: 'Location', options: ['At my home', 'At my office', 'Somewhere nearby', 'Online'], skipIf: PLACE },
    { question: 'How long might it take?', label: 'Time', options: [x('Under an hour', 0.6), x('A few hours', 1.2), x('A full day', 2.5), x('Several days', 4)] },
  ],
  bullets: ['Confirm the details in chat before starting', 'Do the work as described', 'Share photos or proof once done'],
  skills: [],
  budget: [300, 1200],
  difficulty: 'medium',
  onSite: false,
};

// --------------------------------------------------------------- matching ----

function countMatches(re: RegExp | undefined, text: string): number {
  if (!re) return 0;
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return new Set(text.match(g) ?? []).size;
}

/** The best topic for the request: strong words count 3, supporting words 1. */
function topicFor(text: string): Topic {
  const t = normalise(text);
  let best: Topic = FALLBACK;
  let bestScore = 0;
  for (const topic of TOPICS) {
    const score = countMatches(topic.strong, t) * 3 + countMatches(topic.weak, t);
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  // A lone supporting word ("fix", "check") is too weak to commit to a topic.
  return bestScore >= 2 ? best : FALLBACK;
}

const optLabel = (o: Opt) => (typeof o === 'string' ? o : o.label);
const optCost = (o: Opt) => (typeof o === 'string' ? 1 : (o.cost ?? 1));

/** Every question's short label, so facts read "Size: 2 BHK". */
const LABELS = new Map<string, string>();
for (const topic of [...TOPICS, FALLBACK]) for (const a of topic.asks) LABELS.set(a.question, a.label);

function questionsFor(prompt: string): Ask[] {
  const topic = topicFor(prompt);
  const t = normalise(prompt);
  const asks = topic.asks.filter((a) => !a.skipIf || !a.skipIf.test(t));
  const hasWhere = asks.some((a) => a.label === 'Location' || a.label === 'Venue');
  if (topic.onSite && !hasWhere && !PLACE.test(t) && asks.length < 4 && !topic.asks.some((a) => a.label === 'Location')) {
    asks.push(WHERE_HOME);
  }
  return asks.slice(0, 4);
}

// ------------------------------------------------------------------ title ----

/** "hi, can someone please fix my leaking tap urgently" -> "Fix my leaking tap". */
export function titleFrom(prompt: string): string {
  let s = prompt.replace(/\s+/g, ' ').trim();
  const strip: RegExp[] = [
    /^(hi|hello|hey|hii+|namaste|good (morning|evening|afternoon))[,!.\s]+/i,
    /^(mujhe|muje|humein|hume|hamko|mereko)\s+/i,
    /^(please|pls|plz|kindly)\s+/i,
    /^(can|could|would|will) (someone|somebody|anyone|you)( please)?\s+/i,
    /^(is there|are there) (someone|anyone|somebody) (who can|to)\s+/i,
    /^(i'?m|i am|we'?re|we are) looking for\s+/i,
    /^looking for\s+/i,
    /^(i|we) (really )?(want|need|would like|require)( to get| to have| to)?\s+/i,
    /^need( to get| to)?\s+/i,
    /^(someone|somebody|a person|anyone|a guy|a lady)\s+(to|who can|for)\s+/i,
    /^(urgent(ly)?|asap)[:,!\s-]+/i,
    /^(a|an|the)\s+/i,
  ];
  for (let i = 0; i < 3; i++) for (const re of strip) s = s.replace(re, '');
  s = s
    .replace(/\s+(please|pls|plz|asap|urgently|urgent)[.!?]*$/i, '')
    .replace(/\s+(chahiye|chahie|karna hai|karni hai|karwana hai|karwani hai|karwana|karwani|hai)[.!?]*$/i, '')
    .replace(/[.!?,\s]+$/, '');
  if (s.length < 4) s = prompt.trim();
  const short = s.length > 60 ? s.slice(0, 57).replace(/\s+\S*$/, '') + '…' : s;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** "What type of vehicle is it?" -> "Vehicle"; known questions use their own label. */
export function factLabel(question: string): string {
  const known = LABELS.get(question);
  if (known) return known;
  const q = question.trim().replace(/\?$/, '');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (/^where\b/i.test(q)) return 'Location';
  const how = /^how (big|far|long|many|much|often|soon)\b/i.exec(q);
  if (how) {
    const map: Record<string, string> = { big: 'Size', far: 'Distance', long: 'Duration', many: 'Quantity', much: 'Amount', often: 'Frequency', soon: 'When' };
    return map[how[1]!.toLowerCase()]!;
  }
  const kind = /^(?:what|which) (?:type|kind|sort) of (\w+)/i.exec(q);
  if (kind) return cap(kind[1]!);
  const which = /^which (\w+)/i.exec(q);
  if (which) return cap(which[1]!);
  if (/^who\b/i.test(q)) return 'Who';
  return 'Details';
}

// ---------------------------------------------------------------- pricing ----

/** Round a rupee amount to a figure people actually quote. */
function niceRupees(n: number): number {
  const step = n < 1000 ? 50 : n < 5000 ? 100 : n < 20000 ? 500 : 1000;
  return Math.max(step, Math.round(n / step) * step);
}

/** How much the chosen answers move the price: a 3 BHK costs more than a room. */
function costFactor(topic: Topic, answers: Answer[]): number {
  let f = 1;
  for (const a of answers) {
    const ask = [...topic.asks, WHERE_HOME].find((q) => q.question === a.question);
    const opt = ask?.options.find((o) => optLabel(o) === a.answer);
    if (opt) f *= optCost(opt);
  }
  return Math.min(Math.max(f, 0.3), 12);
}

const STOP = new Set(['only', 'just', 'with', 'from', 'more', 'than', 'some', 'needs', 'need', 'look', 'your', 'mine', 'yes', 'and', 'the', 'for']);

/** Does the request say this option? "deep cleaning" says "Deep cleaning";
 *  "Puncture or tyre" is said by either word. */
function promptSays(t: string, label: string): boolean {
  return label
    .toLowerCase()
    .split(/\s+or\s+|\s*\/\s*|,\s*/)
    .some((part) => {
      const words = part.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
      return words.length > 0 && words.every((w) => new RegExp(`\\b${w}`).test(t));
    });
}

/** What the request itself says moves the price too: "2 BHK", "deep cleaning",
 *  "gas refill" count as if that option had been tapped. */
function promptFactor(topic: Topic, t: string): number {
  let f = 1;
  const bhk = /\b(\d) ?bhk\b/.exec(t);
  if (bhk) f *= Math.min(0.6 + Number(bhk[1]) * 0.6, 3);
  for (const ask of topic.asks) {
    if (!ask.skipIf || !ask.skipIf.test(t) || ask === SIZE) continue;
    const said = ask.options.find((o) => optCost(o) !== 1 && promptSays(t, optLabel(o)));
    if (said) f *= optCost(said);
  }
  return f;
}

/** For a request that matched no topic, the "what kind of help" answer still
 *  says where it belongs. */
const FALLBACK_CATEGORY: Record<string, Category> = {
  'Find or buy something': 'Shopping & Sourcing',
  'Check something in person': 'Local Checks & Info',
};

// ------------------------------------------------------------------- post ----

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ').replace(/[.!?]*$/, '.');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function careBullets(care: Topic['care']): string[] {
  switch (care) {
    case 'child':
      return ['Share a valid ID and references before the first visit'];
    case 'elder':
      return ['Share a valid ID before the first visit'];
    case 'pet':
      return ['Be comfortable and experienced with animals'];
    case 'home':
      return ['Share a valid ID before coming home'];
    default:
      return [];
  }
}

function writePost(prompt: string, answers: Answer[], style: WritingStyle): Brief {
  // The questions came from the request alone, so the post uses the same topic.
  const topic = topicFor(prompt);
  const t = normalise(prompt);
  const picked = answers.filter((a) => a.answer && !/^skip/i.test(a.answer));
  const urgent = URGENT.test(t);
  const regular =
    REGULAR.test(t) || picked.some((a) => /\b(every|daily|weekly|weekday|ongoing|twice a week|a few days a week)\b/i.test(a.answer));

  // Price: the topic's usual range, moved by the answers and the request.
  let factor = costFactor(topic, picked) * promptFactor(topic, t);
  if (urgent) factor *= 1.25;
  const min = niceRupees(topic.budget[0] * factor);
  const max = Math.max(niceRupees(topic.budget[1] * factor), min + (min < 1000 ? 100 : 500));

  let difficulty = topic.difficulty;
  if (!regular && factor >= 2.5 && difficulty === 'easy') difficulty = 'medium';
  else if (!regular && factor >= 3 && difficulty === 'medium') difficulty = 'hard';

  const facts = picked.map((a) => `${factLabel(a.question)}: ${a.answer}`);
  const context: string[] = [];
  if (urgent) context.push('Needed urgently — please quote only if you can start soon');
  if (regular) context.push('This is a regular job — quote your price per visit');
  const trust = careBullets(topic.care);

  let bullets: string[];
  if (style === 'short') {
    bullets = [...facts, ...context].slice(0, 3);
    if (bullets.length < 3) bullets.push(...topic.bullets.slice(0, 3 - bullets.length));
  } else if (style === 'detailed') {
    bullets = [...facts, ...context, ...topic.bullets, ...trust, 'Ask in chat if anything is unclear before starting', 'Keep me updated if it takes longer than planned'].slice(0, 9);
  } else {
    bullets = [...facts, ...context, ...topic.bullets.slice(0, 3), ...trust].slice(0, 7);
  }

  const ask = sentence(prompt);
  const summary =
    style === 'casual'
      ? `Hey! I’m looking for ${topic.noun}. ${ask}${urgent ? ' It’s a bit urgent!' : ''}`
      : style === 'short'
        ? ask
        : style === 'detailed'
          ? `${ask} I’m looking for ${topic.noun}${regular ? ' on a regular basis' : ''}${urgent ? ', as soon as possible' : ''}. Details are below — happy to answer any questions in chat.`
          : ask;

  const category =
    topic === FALLBACK
      ? (FALLBACK_CATEGORY[picked.find((a) => a.question === FALLBACK.asks[0]!.question)?.answer ?? ''] ?? 'Other')
      : topic.category;

  return {
    title: titleFrom(prompt),
    summary,
    bullets,
    category,
    pillar: pillarFor(category),
    skills: topic.skills,
    difficulty,
    budgetMinInr: min,
    budgetMaxInr: max,
  };
}

/** The description as it is stored: summary line, then the bullets. */
export function briefToDescription(b: Pick<Brief, 'summary' | 'bullets'>): string {
  const lines = [b.summary.trim(), ...b.bullets.map((x) => '• ' + x.trim())].filter(Boolean);
  return lines.join('\n');
}

// ------------------------------------------------------------- the writer ----

/** Up to four quick questions for a request, none it already answers. */
export function askQuestions(prompt: string): QuickQuestion[] {
  return questionsFor(prompt).map((a) => ({ question: a.question, options: a.options.map(optLabel) }));
}

/** The post: title, summary, checklist, category and a price range from the answers. */
export function askBrief(prompt: string, answers: Answer[], style: WritingStyle): Brief {
  return writePost(prompt, answers, style);
}

// ------------------------------------------------------------ scheduling ----

export const WHEN_OPTIONS = [
  { key: 'now', label: 'Right now', hours: 2 },
  { key: 'today', label: 'Today', hours: 0 },
  { key: '2days', label: '2 days', hours: 48 },
  { key: 'week', label: 'This week', hours: 24 * 7 },
] as const;
export type WhenKey = (typeof WHEN_OPTIONS)[number]['key'];

/** The due time for a "when" choice. "Today" means by 9 pm, or in 3 hours if later. */
export function dueFor(key: WhenKey, from = new Date()): Date {
  if (key === 'today') {
    const ninePm = new Date(from);
    ninePm.setHours(21, 0, 0, 0);
    const soonest = new Date(from.getTime() + 3 * 3600000);
    return ninePm > soonest ? ninePm : soonest;
  }
  const opt = WHEN_OPTIONS.find((o) => o.key === key)!;
  return new Date(from.getTime() + opt.hours * 3600000);
}
