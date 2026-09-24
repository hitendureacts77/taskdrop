import { supabase } from './supabase';
import type { IconName } from '../components/Icon';

/**
 * Everything the "What's on your mind?" posting flow knows about turning a
 * sentence into a task post.
 *
 * The real writer is Claude, behind the ai-assistant Edge Function. This file
 * also carries a small built-in writer that answers the same two questions
 * (which quick questions to ask, and what the brief says) from keyword rules.
 * It runs when the function reports it has no API key, when the person has
 * used today's AI credits, or when the network call fails -- so posting never
 * dead-ends on the assistant.
 */

export type Pillar = 'services' | 'procurement' | 'local_intel';

// Must match CATEGORIES in supabase/functions/ai-assistant/index.ts.
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
  { key: 'professional', label: 'Professional' },
  { key: 'casual', label: 'Casual' },
  { key: 'short', label: 'Short & clear' },
  { key: 'bulleted', label: 'Bulleted' },
  { key: 'detailed', label: 'Detailed' },
  { key: 'hinglish', label: 'Hinglish' },
  { key: 'custom', label: 'Custom' },
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

/** Where an answer came from, so the screen can say so honestly. */
export type Source = 'ai' | 'offline';

// ------------------------------------------------------------- templates ----

export type TemplateTag = 'Legwork' | 'Quick Work' | 'Creative' | 'Tech' | 'Academic' | 'Professional' | 'Advice';

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

export const TEMPLATE_TAGS: TemplateTag[] = ['Legwork', 'Quick Work', 'Creative', 'Tech', 'Academic', 'Professional', 'Advice'];

/** The "Try asking" starters. Each one opens the composer pre-filled. */
export const TEMPLATES: Template[] = [
  { key: 'ask-people', title: 'Ask People', sub: 'Honest answers from real people', tag: 'Quick Work', icon: 'users', prompt: 'Ask 10 people which of these two options they prefer and why: ' },
  { key: 'find-quotes', title: 'Find It & Get Quotes', sub: 'Who has it and what they charge', tag: 'Legwork', icon: 'search', prompt: 'Find 3 shops near me that sell ' },
  { key: 'offload', title: 'Offload My Work', sub: 'A finished piece of your work', tag: 'Professional', icon: 'briefcase', prompt: 'I need someone to finish this piece of work for me: ' },
  { key: 'edit-reel', title: 'Edit My Reel', sub: 'Your footage, cut with music', tag: 'Creative', icon: 'play', prompt: 'Edit my raw footage into a 30-second reel with music and captions', hot: true },
  { key: 'refer-me', title: 'Refer Me at Your Company', sub: 'An intro, or who to reach', tag: 'Legwork', icon: 'send', prompt: 'Looking for an employee referral at ' },
  { key: 'done-it', title: "Ask Someone Who's Done It", sub: 'Advice and next steps', tag: 'Advice', icon: 'help', prompt: 'I want advice from someone who has already ' },
  { key: 'promote', title: 'Promote My Page', sub: 'Posts, and how they performed', tag: 'Creative', icon: 'trending', prompt: 'Help me promote my Instagram page for my small business' },
  { key: 'design', title: 'Design Something', sub: 'Artwork in the sizes you need', tag: 'Creative', icon: 'edit', prompt: 'Design a logo for my ' },
  { key: 'govt-form', title: 'Fill a Govt Form', sub: 'Filled in and ready to submit', tag: 'Legwork', icon: 'list', prompt: 'Help me fill and submit my ', hot: true },
  { key: 'make-call', title: 'Make This Call for Me', sub: 'What was said and agreed', tag: 'Legwork', icon: 'phone', prompt: 'Call this office and find out ', hot: true },
  { key: 'shoot-reel', title: 'Shoot a Reel for Me', sub: 'Filmed and edited, ready to post', tag: 'Creative', icon: 'play', prompt: 'Shoot and edit a short reel of my ' },
  { key: 'resume', title: 'Review My Resume', sub: 'Line-by-line fixes, ATS ready', tag: 'Professional', icon: 'edit', prompt: 'Review my resume and fix it for the ATS for a role in ' },
  { key: 'fix-site', title: 'Fix My Website', sub: 'The broken thing, working again', tag: 'Tech', icon: 'settings', prompt: 'Fix this problem on my website: ' },
  { key: 'exam-prep', title: 'Exam Prep Coach', sub: 'A plan for what to revise first', tag: 'Academic', icon: 'list', prompt: 'Make me a revision plan for my exam on ' },
  { key: 'portfolio', title: 'Build Portfolio Site', sub: 'A one-page site with your work', tag: 'Tech', icon: 'compass', prompt: 'Build a one-page portfolio website for my work as a ' },
  { key: 'shops-near', title: 'Find Shops Near Me', sub: 'Which shops, the price, a number', tag: 'Legwork', icon: 'pin', prompt: 'Find shops near me that repair ', hot: true },
  { key: 'local-help', title: 'Find Me Local Help', sub: 'Three people, with rates', tag: 'Legwork', icon: 'users', prompt: 'Find me 3 reliable ' },
  { key: 'area', title: 'Do Something for the Area', sub: 'Photos of it done, and the ticket', tag: 'Legwork', icon: 'flag', prompt: 'Report the broken streetlight on my road to the municipality and share the complaint number' },
  { key: 'signups', title: 'Get Me Real Signups', sub: 'Real signups, with proof', tag: 'Quick Work', icon: 'check', prompt: 'Get 20 real people to sign up for ' },
  { key: 'check-this', title: 'Check This for Me', sub: 'Confirmed answers, and who said so', tag: 'Quick Work', icon: 'eye', prompt: 'Visit this place and check whether ' },
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

type Rule = {
  category: Category;
  words: RegExp;
  questions: (text: string) => QuickQuestion[];
  bullets: string[];
  skills: string[];
  budget: [number, number];
  difficulty: Brief['difficulty'];
};

const WHERE: QuickQuestion = {
  question: 'Where should this happen?',
  options: ['At my home', 'At my office', 'Somewhere nearby', 'Remote is fine'],
};

const RULES: Rule[] = [
  {
    category: 'Repairs & Maintenance',
    words: /\b(repair|fix|broken|mechanic|service|servicing|leak|plumb|electric|puncture|bike|scooter|scooty|car|ac|fridge|washing machine|fan|geyser|tap|wiring|stand)\b/i,
    questions: (text) => [
      /\b(bike|scooter|scooty|car|motor|cycle|vehicle|stand|puncture)\b/i.test(text)
        ? { question: 'What type of vehicle is it?', options: ['Motorcycle', 'Scooter', 'Bicycle', 'E-bike', 'Car'] }
        : /\b(ac|fridge|washing|fan|geyser|tv|microwave|appliance)\b/i.test(text)
          ? { question: 'Which appliance is it?', options: ['AC', 'Fridge', 'Washing machine', 'Fan or light', 'Geyser'] }
          : { question: 'What needs fixing?', options: ['A vehicle', 'An appliance', 'Plumbing', 'Electrical', 'Furniture'] },
      { question: 'What kind of repair do you need?', options: ['Not working at all', 'Damaged or broken part', 'General servicing', 'Not sure, needs diagnosis'] },
      { question: 'Where is it right now?', options: ['At home', 'At my office', 'At a shop', 'On the road'] },
    ],
    bullets: ['Diagnose the problem and explain it before starting', 'Bring the tools and common spare parts', 'Share the cost of any parts before buying them', 'Test that it works properly once done'],
    skills: ['repair', 'on_site_service'],
    budget: [300, 1500],
    difficulty: 'medium',
  },
  {
    category: 'Home Services',
    words: /\b(clean|cleaning|paint|painting|shift|shifting|move|moving|pest|cook|maid|carpenter|furniture|assemble|install|deep clean|sofa|kitchen)\b/i,
    questions: () => [
      { question: 'What kind of help do you need?', options: ['Cleaning', 'Painting', 'Assembly or carpentry', 'Shifting or moving', 'Pest control'] },
      { question: 'How big is the place?', options: ['1 room', '1 BHK', '2 BHK', '3 BHK or more'] },
      { question: 'Who brings the materials?', options: ['Worker brings everything', 'I have the materials', 'Discuss first'] },
    ],
    bullets: ['Confirm the scope and time needed before starting', 'Bring the tools needed for the job', 'Leave the area clean when finished', 'Share before-and-after photos'],
    skills: ['home_service'],
    budget: [500, 3000],
    difficulty: 'medium',
  },
  {
    category: 'Errands & Delivery',
    words: /\b(deliver|delivery|pick up|pickup|courier|drop|errand|collect|queue|parcel|send)\b/i,
    questions: () => [
      { question: 'What is being moved?', options: ['Documents', 'A small parcel', 'Groceries', 'Something large'] },
      { question: 'How far is it?', options: ['Within 2 km', '2–10 km', 'Across the city'] },
      { question: 'What proof do you need?', options: ['Photo on delivery', 'A receipt', 'Just a message'] },
    ],
    bullets: ['Pick up from the agreed place', 'Handle it carefully and keep it dry', 'Deliver to the address shared in chat', 'Send a photo once it is delivered'],
    skills: ['delivery', 'errands'],
    budget: [100, 500],
    difficulty: 'easy',
  },
  {
    category: 'Shopping & Sourcing',
    words: /\b(buy|find|source|shop|purchase|get me|looking for|price|second hand|used|new)\b/i,
    questions: () => [
      { question: 'New or used?', options: ['New only', 'Used is fine', 'Either'] },
      { question: 'How many options do you want?', options: ['Just the best one', 'Top 3 options', 'As many as possible'] },
      { question: 'How should it reach you?', options: ['Deliver it to me', 'I will pick it up', 'Just send the options'] },
    ],
    bullets: ['Compare prices from at least three sellers', 'Share photos and the exact price before buying', 'Check the condition and any warranty', 'Keep the bill and hand it over'],
    skills: ['sourcing', 'price_comparison'],
    budget: [200, 1000],
    difficulty: 'easy',
  },
  {
    category: 'Local Checks & Info',
    words: /\b(check|verify|visit|inspect|is there|open now|rent|flat|photos of|see if|confirm|survey|ask \d+ people|ask people)\b/i,
    questions: () => [
      { question: 'What should they check?', options: ['Take photos and video', 'Ask questions in person', 'Confirm it is available', 'Inspect the condition'] },
      { question: 'How should they report back?', options: ['Photos with notes', 'A short video', 'A call summary'] },
    ],
    bullets: ['Visit the place in person', 'Take clear photos or a short video', 'Answer the questions shared in chat', 'Send a short written summary'],
    skills: ['local_intel', 'field_check'],
    budget: [200, 800],
    difficulty: 'easy',
  },
  {
    category: 'Tech & Websites',
    words: /\b(website|site|app|bug|code|coding|wordpress|shopify|laptop|computer|software|excel macro|domain|hosting|api)\b/i,
    questions: () => [
      { question: 'What is the work?', options: ['Fix a problem', 'Build something new', 'Set up or install', 'Advice only'] },
      { question: 'What is it built on?', options: ['Website', 'Mobile app', 'Excel or Sheets', 'Laptop or PC'] },
      { question: 'Can it be done remotely?', options: ['Remote is fine', 'Must be in person'] },
    ],
    bullets: ['Look at the problem and confirm the fix before starting', 'Make the change without breaking anything else', 'Explain what was changed', 'Share access back once done'],
    skills: ['web_development', 'troubleshooting'],
    budget: [500, 5000],
    difficulty: 'hard',
  },
  {
    category: 'Design & Creative',
    words: /\b(logo|design|poster|banner|thumbnail|illustration|edit|editing|reel|canva|brand|flyer|card)\b/i,
    questions: () => [
      { question: 'What should be delivered?', options: ['Logo', 'Social post or banner', 'Video edit', 'Illustration'] },
      { question: 'What style do you like?', options: ['Minimal', 'Bold and colourful', 'Match my brand', 'Surprise me'] },
      { question: 'How many revisions?', options: ['1 round', '2 rounds', 'Until I am happy'] },
    ],
    bullets: ['Share a first draft for feedback', 'Include the agreed rounds of changes', 'Deliver final files in the sizes needed', 'Hand over editable source files'],
    skills: ['graphic_design'],
    budget: [300, 3000],
    difficulty: 'medium',
  },
  {
    category: 'Writing & Content',
    words: /\b(write|writing|content|blog|caption|article|translate|translation|copy|script|proofread)\b/i,
    questions: () => [
      { question: 'What should be written?', options: ['Social captions', 'A blog or article', 'Website copy', 'A translation'] },
      { question: 'How long?', options: ['Under 300 words', '300–1000 words', 'Longer'] },
      { question: 'Which language?', options: ['English', 'Hindi', 'Hinglish', 'Another language'] },
    ],
    bullets: ['Write original content, no copying', 'Match the tone and audience shared in chat', 'Include one round of edits', 'Deliver as an editable document'],
    skills: ['content_writing'],
    budget: [300, 2000],
    difficulty: 'medium',
  },
  {
    category: 'Photo & Video',
    words: /\b(photo|photographer|shoot|video|videographer|film|camera|drone)\b/i,
    questions: () => [
      { question: 'What is the shoot for?', options: ['Product photos', 'An event', 'Portraits', 'Social media reel'] },
      { question: 'How long is the shoot?', options: ['Under an hour', '1–3 hours', 'Half day or more'] },
      { question: 'Do you need editing?', options: ['Yes, edited files', 'Raw files are fine'] },
    ],
    bullets: ['Arrive on time with your own equipment', 'Cover the shots agreed in chat', 'Deliver edited files within the agreed time', 'Share a download link with everything'],
    skills: ['photography', 'video'],
    budget: [1000, 5000],
    difficulty: 'medium',
  },
  {
    category: 'Tutoring & Education',
    words: /\b(tutor|teach|teacher|exam|homework|learn|class|lesson|coach|maths|physics|chemistry|english speaking|revision)\b/i,
    questions: () => [
      { question: 'Which level?', options: ['School', 'College', 'Competitive exam', 'Just for me'] },
      { question: 'How should sessions happen?', options: ['Online', 'At my home', 'Either'] },
      { question: 'How many sessions?', options: ['Just one', 'A few', 'Weekly'] },
    ],
    bullets: ['Assess the current level in the first session', 'Explain concepts step by step', 'Share practice questions', 'Track progress between sessions'],
    skills: ['tutoring'],
    budget: [300, 1500],
    difficulty: 'medium',
  },
  {
    category: 'Career & Resume',
    words: /\b(resume|cv|referral|interview|job|linkedin|internship|hr|placement)\b/i,
    questions: () => [
      { question: 'What do you need?', options: ['Resume review', 'An employee referral', 'Mock interview', 'LinkedIn profile'] },
      { question: 'Which field?', options: ['IT or software', 'Sales or marketing', 'Finance', 'Something else'] },
    ],
    bullets: ['Review the documents shared in chat', 'Give specific, line-by-line suggestions', 'Share an improved version', 'Suggest clear next steps'],
    skills: ['career_coaching'],
    budget: [200, 1500],
    difficulty: 'easy',
  },
  {
    category: 'Business & Consulting',
    words: /\b(business|startup|plan|marketing|gst|consult|strategy|pitch|brand|sales|food cart|shop setup)\b/i,
    questions: () => [
      { question: 'What stage is the business at?', options: ['Just an idea', 'Starting soon', 'Already running'] },
      { question: 'What kind of help?', options: ['A step-by-step plan', 'Registrations and licences', 'Marketing', 'Numbers and costs'] },
    ],
    bullets: ['Understand the goal and current situation', 'Share a clear, practical plan', 'List costs and registrations needed', 'Answer follow-up questions in chat'],
    skills: ['business_consulting'],
    budget: [500, 3000],
    difficulty: 'medium',
  },
  {
    category: 'Events & Planning',
    words: /\b(wedding|birthday|party|event|decor|decoration|anniversary|function|catering)\b/i,
    questions: () => [
      { question: 'What is the event?', options: ['Birthday', 'Wedding', 'Office event', 'Something else'] },
      { question: 'How many guests?', options: ['Under 20', '20–100', 'More than 100'] },
      { question: 'What help do you need?', options: ['Decoration', 'Coordination on the day', 'Finding vendors', 'Everything'] },
    ],
    bullets: ['Confirm the plan and timeline in advance', 'Coordinate with vendors as agreed', 'Be present on the day', 'Share photos of the setup'],
    skills: ['event_planning'],
    budget: [1000, 10000],
    difficulty: 'medium',
  },
  {
    category: 'Admin & Data Entry',
    words: /\b(data entry|typing|type|form|forms|spreadsheet|excel|sheet|pdf|scan|govt|government|aadhaar|pan|passport|application)\b/i,
    questions: () => [
      { question: 'What is the work?', options: ['Typing or data entry', 'Fill a form', 'Organise files', 'Something else'] },
      { question: 'How much is there?', options: ['A few pages', 'Around 100 entries', 'Lots'] },
    ],
    bullets: ['Work from the documents shared in chat', 'Double-check every entry', 'Deliver in the format asked for', 'Keep personal details private'],
    skills: ['data_entry'],
    budget: [200, 1500],
    difficulty: 'easy',
  },
];

const FALLBACK: Rule = {
  category: 'Other',
  words: /./,
  questions: () => [
    { question: 'What kind of help is this?', options: ['Hands-on work', 'Find or buy something', 'Check something locally', 'Online work'] },
    WHERE,
  ],
  bullets: ['Confirm the details in chat before starting', 'Do the work as described', 'Share proof once it is done'],
  skills: [],
  budget: [200, 1000],
  difficulty: 'medium',
};

function ruleFor(text: string): Rule {
  return RULES.find((r) => r.words.test(text)) ?? FALLBACK;
}

/** "i want a mechanic to repair my bike" -> "Mechanic to repair my bike". */
export function titleFrom(prompt: string): string {
  const cleaned = prompt
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(hi|hello|hey)[,!.\s]+/i, '')
    .replace(/^(i|we)\s+(want|need|would like|am looking for|are looking for)\s+(to\s+)?/i, '')
    .replace(/^(someone|somebody|a person|anyone)\s+(to|who can)\s+/i, '')
    .replace(/^(please|pls)\s+/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/[.!?]+$/, '');
  const short = cleaned.length > 60 ? cleaned.slice(0, 57).replace(/\s+\S*$/, '') + '…' : cleaned;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function offlineQuestions(prompt: string): QuickQuestion[] {
  return ruleFor(prompt).questions(prompt).slice(0, 3);
}

/** "What type of vehicle is it?" -> "Vehicle", "Where is it right now?" -> "Location". */
export function factLabel(question: string): string {
  const q = question.trim().replace(/\?$/, '');
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (/^where\b/i.test(q)) return 'Location';
  const how = /^how (big|far|long|many|much)\b/i.exec(q);
  if (how) {
    const map: Record<string, string> = { big: 'Size', far: 'Distance', long: 'Duration', many: 'Quantity', much: 'Amount' };
    return map[how[1]!.toLowerCase()]!;
  }
  const kind = /^(?:what|which) (?:type|kind|sort) of (\w+)/i.exec(q);
  if (kind) return cap(kind[1]!);
  const which = /^which (\w+)/i.exec(q);
  if (which) return cap(which[1]!);
  if (/^who\b/i.test(q)) return 'Who';
  return 'Details';
}

function offlineBrief(prompt: string, answers: Answer[], style: WritingStyle): Brief {
  const rule = ruleFor(prompt + ' ' + answers.map((a) => a.answer).join(' '));
  const picked = answers.filter((a) => a.answer && !/^skip/i.test(a.answer));
  const facts = picked.map((a) => `${factLabel(a.question)}: ${a.answer.charAt(0).toUpperCase() + a.answer.slice(1)}`);
  let bullets = [...facts, ...rule.bullets];
  if (style === 'short') bullets = bullets.slice(0, 3);
  if (style === 'detailed') {
    bullets = [...bullets, 'Ask in chat if anything is unclear before starting', 'Keep me updated if it takes longer than planned'];
  }
  const summary =
    style === 'casual'
      ? `Hey! Looking for someone to help with this: ${prompt.trim().replace(/[.!?]*$/, '.')}`
      : prompt.trim().replace(/[.!?]*$/, '.').replace(/^./, (c) => c.toUpperCase());
  return {
    title: titleFrom(prompt),
    summary,
    bullets: bullets.slice(0, 6),
    category: rule.category,
    pillar: pillarFor(rule.category),
    skills: rule.skills,
    difficulty: rule.difficulty,
    budgetMinInr: rule.budget[0],
    budgetMaxInr: rule.budget[1],
  };
}

/** The description as it is stored: summary line, then the bullets. */
export function briefToDescription(b: Pick<Brief, 'summary' | 'bullets'>): string {
  const lines = [b.summary.trim(), ...b.bullets.map((x) => '• ' + x.trim())].filter(Boolean);
  return lines.join('\n');
}

// ------------------------------------------------------------- assistant ----

type AssistantError = { error?: string; offline?: boolean; credits?: number };

async function invoke<T>(body: Record<string, unknown>): Promise<{ data: T; credits?: number } | { fallback: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-assistant', { body });
    if (error) {
      // supabase-js hides the JSON body of a non-2xx on error.context.
      const ctx = (error as { context?: unknown }).context;
      let out: AssistantError = {};
      if (ctx instanceof Response) {
        try {
          out = (await ctx.clone().json()) as AssistantError;
        } catch {
          /* not JSON */
        }
      }
      if (out.offline) return { fallback: 'offline' };
      if (typeof out.credits === 'number' && out.credits <= 0) {
        return { fallback: out.error ?? 'You have used today’s AI credits.' };
      }
      return { fallback: out.error ?? 'The assistant could not answer.' };
    }
    const d = data as T & { credits?: number };
    return { data: d, credits: d.credits };
  } catch {
    return { fallback: 'The assistant could not be reached.' };
  }
}

export type AssistantResult<T> = {
  value: T;
  source: Source;
  /** Why the built-in writer was used instead, when it was. */
  note?: string;
  /** Credits left today, when the AI answered. */
  credits?: number;
};

export async function askQuestions(prompt: string): Promise<AssistantResult<QuickQuestion[]>> {
  const out = await invoke<{ questions: QuickQuestion[] }>({ action: 'questions', prompt });
  if ('data' in out && out.data.questions?.length) {
    return { value: out.data.questions, source: 'ai', credits: out.credits };
  }
  return {
    value: offlineQuestions(prompt),
    source: 'offline',
    note: 'fallback' in out && out.fallback !== 'offline' ? out.fallback : undefined,
  };
}

export async function askBrief(
  prompt: string,
  answers: Answer[],
  style: WritingStyle,
  customStyle?: string,
): Promise<AssistantResult<Brief>> {
  const out = await invoke<{ brief: Brief }>({ action: 'brief', prompt, answers, style, customStyle });
  if ('data' in out && out.data.brief) {
    const b = out.data.brief;
    return { value: { ...b, pillar: b.pillar ?? pillarFor(b.category) }, source: 'ai', credits: out.credits };
  }
  return {
    value: offlineBrief(prompt, answers, style),
    source: 'offline',
    note: 'fallback' in out && out.fallback !== 'offline' ? out.fallback : undefined,
  };
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
