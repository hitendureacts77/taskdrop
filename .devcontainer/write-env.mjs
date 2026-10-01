// Write apps/mobile/.env from the codespace's secrets, so `npm run web` works
// without copying .env.example by hand. An existing .env is left alone.

import { existsSync, writeFileSync } from 'node:fs';

const target = 'apps/mobile/.env';

if (existsSync(target)) {
  console.log(`${target} already exists; leaving it as is.`);
  process.exit(0);
}

const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://wjxvingpfbfvkfqhrguj.supabase.co';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

writeFileSync(
  target,
  [
    `EXPO_PUBLIC_SUPABASE_URL=${url}`,
    `EXPO_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=${mapsKey}`,
    '',
  ].join('\n'),
);

console.log(`Wrote ${target}.`);
if (!anonKey) {
  console.warn(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY is not set. Add it as a Codespaces secret, ' +
      `or paste it into ${target}, before running \`npm run web\`.`,
  );
}
