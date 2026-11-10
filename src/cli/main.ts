import { existsSync } from 'node:fs';
import { runCli } from './run.ts';

// Optional local settings. Variables already set in the environment win.
if (existsSync('.env')) process.loadEnvFile('.env');

const status = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
});
process.exitCode = status;
