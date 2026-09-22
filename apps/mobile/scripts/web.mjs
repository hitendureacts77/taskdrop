// Start Expo web on whichever port the caller asked for.
//
// `expo start` does not read PORT from the environment -- it defaults to 8081,
// and when that is taken it stops to ask "use 8082 instead?", which is fatal in
// a non-interactive shell. Tooling that assigns a free port hands it over in
// PORT, so translate that into the --port flag Expo actually honours.
//
// With nothing set this is exactly the old behaviour: Expo web on 8081.

import { spawn } from 'node:child_process';

const port = process.env.PORT || '8081';

const child = spawn(
  'npx',
  ['expo', 'start', '--web', '--port', port, ...process.argv.slice(2)],
  { stdio: 'inherit', shell: true },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
