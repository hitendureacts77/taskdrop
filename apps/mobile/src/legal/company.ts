/**
 * Who TaskDrop is, legally, for the Terms, the Privacy Policy and India's
 * grievance-officer rule. Set at build time (EXPO_PUBLIC_*, see .env.example);
 * nothing here is made up. An unset value falls back to wording that is still
 * true ("through Help & support in the app"), and `unset` lists what is missing
 * so development builds can say so.
 *
 * Expo inlines EXPO_PUBLIC_* only when written out in full, so each one is.
 */
const env = {
  EXPO_PUBLIC_LEGAL_ENTITY: process.env.EXPO_PUBLIC_LEGAL_ENTITY?.trim() ?? '',
  EXPO_PUBLIC_LEGAL_ADDRESS: process.env.EXPO_PUBLIC_LEGAL_ADDRESS?.trim() ?? '',
  EXPO_PUBLIC_LEGAL_EMAIL: process.env.EXPO_PUBLIC_LEGAL_EMAIL?.trim() ?? '',
  EXPO_PUBLIC_GRIEVANCE_OFFICER_NAME: process.env.EXPO_PUBLIC_GRIEVANCE_OFFICER_NAME?.trim() ?? '',
  EXPO_PUBLIC_GRIEVANCE_OFFICER_EMAIL: process.env.EXPO_PUBLIC_GRIEVANCE_OFFICER_EMAIL?.trim() ?? '',
  EXPO_PUBLIC_LEGAL_JURISDICTION: process.env.EXPO_PUBLIC_LEGAL_JURISDICTION?.trim() ?? '',
};

export const company = {
  /** The legal entity that runs TaskDrop, or the brand until it is set. */
  entity: env.EXPO_PUBLIC_LEGAL_ENTITY || 'TaskDrop',
  address: env.EXPO_PUBLIC_LEGAL_ADDRESS || null,
  email: env.EXPO_PUBLIC_LEGAL_EMAIL || null,
  grievanceName: env.EXPO_PUBLIC_GRIEVANCE_OFFICER_NAME || null,
  grievanceEmail: env.EXPO_PUBLIC_GRIEVANCE_OFFICER_EMAIL || env.EXPO_PUBLIC_LEGAL_EMAIL || null,
  /** The city whose courts hear disputes, e.g. "Hyderabad". */
  jurisdiction: env.EXPO_PUBLIC_LEGAL_JURISDICTION || null,
  /** Set to "yes" once a lawyer has approved the Terms and Privacy Policy text. */
  reviewed: process.env.EXPO_PUBLIC_LEGAL_REVIEWED?.trim().toLowerCase() === 'yes',
};

/** The settings still to fill in. */
export const unset = (Object.keys(env) as (keyof typeof env)[]).filter((k) => !env[k]);

/** "write to privacy@… or …", or the in-app route when no address is set. */
export function contactLine(email: string | null): string {
  return email ? `email ${email} or write to us through Help & support in the app` : 'write to us through Help & support in the app';
}
