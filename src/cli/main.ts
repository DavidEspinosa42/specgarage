import { existsSync } from 'node:fs';
import { runCli } from './run.ts';

// Optional local settings. Variables already set in the environment win.
if (existsSync('.env')) process.loadEnvFile('.env');

// Long-running commands such as `serve` stop cleanly on Ctrl+C or a termination request.
const shutdown = new Promise<void>((resolve) => {
  process.once('SIGINT', () => resolve());
  process.once('SIGTERM', () => resolve());
});

const status = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  shutdown,
});
process.exitCode = status;
