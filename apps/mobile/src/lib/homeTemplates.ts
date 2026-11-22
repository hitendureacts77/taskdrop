import type { Category, Template } from './taskBrief';

/**
 * "Idea templates for you" on Hire Home (D32). The templates are the ones the composer already has (TEMPLATES);
 * this file only says which category each one sits under (for the chips) and which day it suggests. Static order:
 * no ranking, no network.
 */
const CATEGORY_OF: Record<string, Category> = {
  'ask-people': 'Local Checks & Info',
  'find-quotes': 'Shopping & Sourcing',
  offload: 'Business & Consulting',
  'edit-reel': 'Photo & Video',
  'refer-me': 'Career & Resume',
  'done-it': 'Business & Consulting',
  promote: 'Business & Consulting',
  design: 'Design & Creative',
  'govt-form': 'Admin & Data Entry',
  'make-call': 'Errands & Delivery',
  'shoot-reel': 'Photo & Video',
  resume: 'Career & Resume',
  'fix-site': 'Tech & Websites',
  'exam-prep': 'Tutoring & Education',
  portfolio: 'Tech & Websites',
  'shops-near': 'Local Checks & Info',
  'local-help': 'Home Services',
  area: 'Local Checks & Info',
  signups: 'Business & Consulting',
  'check-this': 'Local Checks & Info',
};

/** A day (the composer's own When key) for the ones that are usually wanted soon; the rest say "In 2 days". */
const TODAY = new Set(['make-call', 'check-this', 'shops-near', 'local-help']);
const WEEK = new Set(['govt-form', 'portfolio', 'edit-reel', 'shoot-reel']);

export type HomeTemplate = Template & { category: Category; when: 'today' | '2days' | 'week' };

export function homeTemplates(templates: readonly Template[]): HomeTemplate[] {
  return templates.map((x) => ({
    ...x,
    category: CATEGORY_OF[x.key] ?? 'Other',
    when: TODAY.has(x.key) ? 'today' : WEEK.has(x.key) ? 'week' : '2days',
  }));
}

/** The category chips: only those with a template, in the app's category order. */
export function templateCategories(list: HomeTemplate[], categories: readonly Category[]): Category[] {
  return categories.filter((c) => list.some((x) => x.category === c));
}

/** One chip's templates; no chip (null) is "For you": all of them, in order. */
export function templatesIn(list: HomeTemplate[], category: Category | null): HomeTemplate[] {
  return category ? list.filter((x) => x.category === category) : list;
}

export const WHEN_WORDS: Record<HomeTemplate['when'], string> = { today: 'Today', '2days': 'In 2 days', week: 'This week' };
