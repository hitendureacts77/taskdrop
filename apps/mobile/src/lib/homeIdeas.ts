import type { IconName } from '../components/Icon';
import type { HomeTemplate } from './homeTemplates';

/**
 * Hire Home's one "Ideas to post" block (task 1.19 F, decision 1). It merges three blocks that used to sit one under
 * another: the poster ideas (D29, six groups), the Quick templates (D32, the composer's own templates) and the nine
 * "manage your tasks" tiles. Each group is a chip; "For you" shows a few from all of them. Every idea is still here
 * (one chip away) and every template is still on Explore's list, Ideas tab. Pure data and choices, no React.
 */

export type PosterIdea = { icon: IconName; title: string; problem: string; price: string; prompt: string };

// Poster ideas (D29, owner 11 Nov): outcome jobs no other app does.
export const POSTER_IDEAS: { group: string; ideas: PosterIdea[] }[] = [
  {
    group: 'Money back',
    ideas: [
      { icon: 'wallet', title: 'Get my PF out', problem: 'PF claim rejected or stuck? Someone fixes it and follows up.', price: 'from ₹800', prompt: 'My PF withdrawal is stuck. Fix the problem and follow up until the money comes: ' },
      { icon: 'shield', title: 'Claim my insurance', problem: 'Hospital or vehicle claim stuck? Get it filed and paid.', price: 'from ₹1,000', prompt: 'My insurance claim is stuck. File the papers and follow up until it is paid: ' },
      { icon: 'home', title: 'Get my deposit back', problem: 'Moving out? Someone documents the flat and chases the owner.', price: 'from ₹1,000', prompt: 'I am moving out of my rented flat. Video the flat, list what is fair, and follow up with the owner for my deposit of ₹' },
      { icon: 'card', title: 'Fix my credit score', problem: 'A wrong entry on your CIBIL? Raise the dispute and follow it.', price: 'from ₹700', prompt: 'A wrong entry is showing on my CIBIL report. Raise the dispute and follow it until it is fixed: ' },
    ],
  },
  {
    group: 'Earn from it',
    ideas: [
      { icon: 'tag', title: 'Sell my stuff', problem: 'Moving or upgrading? Someone sells it for a good price.', price: '10% of the sale', prompt: 'Sell these things for me at a good price and handle the buyers: ' },
      { icon: 'home', title: 'Rent out my empty flat', problem: 'Find a tenant, show the flat, check them, sign the agreement.', price: 'from ₹3,000', prompt: 'Find a good tenant for my empty flat, show it, check them and get the agreement signed. The flat is in ' },
      { icon: 'camera', title: 'Shoot my products', problem: 'Photos that sell, for Instagram, Meesho or Amazon.', price: 'from ₹1,500', prompt: 'Take product photos for my online listing. Products: ' },
    ],
  },
  {
    group: 'Be there for me',
    ideas: [
      { icon: 'eye', title: 'Watch my plot', problem: 'Monthly photos of your plot or empty flat, and alerts.', price: '₹500 a month', prompt: 'Visit my plot once a month, send photos of the fence and boundary, and tell me if anyone builds near it. The plot is in ' },
      { icon: 'wrench', title: 'Watch my house being built', problem: 'Weekly site visits: material counts and photos.', price: '₹700 a visit', prompt: 'Visit my house construction site every week, count the cement and steel that came in, and send photos. The site is in ' },
      { icon: 'heart', title: 'Hospital runner', problem: 'Billing, insurance desk and medicines while you stay by the bed.', price: '₹1,500 a day', prompt: 'Someone in my family is in hospital. Handle the billing desk, insurance desk and medicines while I stay with them. Hospital: ' },
      { icon: 'gift', title: 'Surprise them for me', problem: 'Cake, flowers and a midnight surprise in another city.', price: 'from ₹2,000', prompt: 'Plan a midnight birthday surprise with cake, flowers and decoration, and send me a video. It is for my ' },
    ],
  },
  {
    group: 'Before I buy',
    ideas: [
      { icon: 'check', title: 'Check my new flat', problem: 'A snag list for the builder before you take possession.', price: 'from ₹3,000', prompt: 'I am taking possession of my new flat. Check every wall, tap and switch and give me a snag list for the builder. The flat is in ' },
      { icon: 'search', title: 'Check this plot before I buy', problem: 'EC, land records, a site visit and a word with neighbours.', price: 'from ₹2,500', prompt: 'Before I buy this plot, get the EC and land records, visit it and ask the neighbours about any disputes. The plot is in ' },
      { icon: 'compass', title: 'Flat hunt for me', problem: 'Shortlist, visit and video tour flats before you move.', price: 'from ₹1,500', prompt: 'I am moving to a new city. Shortlist 5 flats, visit them and send me video tours. Area and budget: ' },
    ],
  },
  {
    group: 'Grow my business',
    ideas: [
      { icon: 'globe', title: 'Put my shop online', problem: 'Google Maps, Swiggy or Zomato, and a WhatsApp catalogue.', price: 'from ₹2,000', prompt: 'Put my shop online: Google Maps listing, food or shopping apps, and a WhatsApp catalogue. My shop is ' },
      { icon: 'trending', title: 'Launch me in my area', problem: 'Get the word out in nearby societies and groups.', price: 'from ₹3,000', prompt: 'Tell the gated communities near me about my new business through society groups and a weekend stall. My business is ' },
    ],
  },
  {
    group: 'My career',
    ideas: [
      { icon: 'send', title: 'Apply for me', problem: '50 job applications a week, tracked in a sheet.', price: 'from ₹1,000', prompt: 'Apply to jobs for me this week with my resume and keep a sheet of where you applied. The roles I want: ' },
      { icon: 'list', title: 'Fill my college options', problem: 'Order your counselling choices for your rank.', price: 'from ₹800', prompt: 'Help me order my college options for counselling. My exam and rank: ' },
    ],
  },
];

/** The errands people hand off most (the old "manage your tasks" tiles). `key`: the template whose words it uses. */
export const EVERYDAY: { icon: IconName; title: string; key?: string; prompt: string }[] = [
  { icon: 'briefcase', title: 'Hand off a task', key: 'offload', prompt: 'I need someone to finish this piece of work for me: ' },
  { icon: 'play', title: 'Reel editing', key: 'edit-reel', prompt: 'Edit my raw footage into a 30-second reel with music and captions' },
  { icon: 'send', title: 'Job referral', key: 'refer-me', prompt: 'Looking for an employee referral at ' },
  { icon: 'trending', title: 'Grow my page', key: 'promote', prompt: 'Help me promote my Instagram page for my small business' },
  { icon: 'chat', title: 'Talk to someone who did it', key: 'done-it', prompt: 'I want advice from someone who has already ' },
  { icon: 'wrench', title: 'Scooter repair', prompt: 'My scooter needs repair: ' },
  { icon: 'list', title: 'Govt form help', key: 'govt-form', prompt: 'Help me fill and submit my ' },
  { icon: 'gavel', title: 'Legal services help', prompt: 'I need help from a lawyer with ' },
  { icon: 'users', title: 'Queue for me', prompt: 'Stand in the queue for me at ' },
];

export const FOR_YOU = 'For you';
export const QUICK_TEMPLATES = 'Quick templates';
export const EVERYDAY_CHIP = 'Everyday';

/** The chips, in the drawn order; the three groups the phone mock leaves past the edge come last. */
export const IDEA_CHIPS: string[] = [
  FOR_YOU,
  'Money back',
  'Be there for me',
  'Before I buy',
  QUICK_TEMPLATES,
  EVERYDAY_CHIP,
  'Earn from it',
  'Grow my business',
  'My career',
];

/** One card of the block, whatever it came from. `price` (ideas) or `when` (templates) is its last line. */
export type IdeaItem = {
  key: string;
  kind: 'idea' | 'template' | 'everyday';
  icon: IconName;
  title: string;
  sub: string | null;
  price?: string;
  when?: HomeTemplate['when'];
  prompt: string;
  /** The template behind it, for the card's testID (home-template-<key>). */
  templateKey?: string;
};

const fromIdea = (x: PosterIdea): IdeaItem => ({ key: 'idea-' + x.title, kind: 'idea', icon: x.icon, title: x.title, sub: x.problem, price: x.price, prompt: x.prompt });
const fromTemplate = (x: HomeTemplate): IdeaItem => ({
  key: 'tpl-' + x.key,
  kind: 'template',
  icon: x.icon,
  title: x.title,
  sub: x.sub,
  when: x.when,
  prompt: x.prompt,
  templateKey: x.key,
});

/** "For you": the drawn picks, two outcome ideas and two quick templates first (the phone shows four). */
const FOR_YOU_PICKS: ({ idea: string } | { template: string })[] = [
  { idea: 'Get my PF out' },
  { idea: 'Watch my plot' },
  { template: 'make-call' },
  { template: 'offload' },
  { idea: 'Hospital runner' },
  { idea: 'Put my shop online' },
];

const allIdeas = () => POSTER_IDEAS.flatMap((g) => g.ideas);

/** One chip's cards. An unknown chip shows "For you". */
export function ideasIn(chip: string, templates: readonly HomeTemplate[]): IdeaItem[] {
  if (chip === QUICK_TEMPLATES) return templates.map(fromTemplate);
  if (chip === EVERYDAY_CHIP) {
    return EVERYDAY.map((x) => {
      const tpl = x.key ? templates.find((y) => y.key === x.key) : undefined;
      return { key: 'everyday-' + x.title, kind: 'everyday', icon: x.icon, title: x.title, sub: tpl?.sub ?? null, prompt: tpl?.prompt ?? x.prompt };
    });
  }
  const group = POSTER_IDEAS.find((g) => g.group === chip);
  if (group) return group.ideas.map(fromIdea);
  return FOR_YOU_PICKS.flatMap((p) => {
    if ('idea' in p) {
      const x = allIdeas().find((y) => y.title === p.idea);
      return x ? [fromIdea(x)] : [];
    }
    const x = templates.find((y) => y.key === p.template);
    return x ? [fromTemplate(x)] : [];
  });
}

/** "from ₹800" reads "₹800+" on a card; a price that says how it is paid stays as it is. */
export function offerLine(price: string): string {
  return price.startsWith('from ') ? `${price.slice(5)}+` : price;
}
