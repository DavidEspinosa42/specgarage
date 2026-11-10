import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.ts';
import { demoRulepackPath } from '../helpers.ts';

let directory: string;
let dataDir: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'specgarage-cli-'));
  dataDir = join(directory, 'data');
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

interface Result {
  status: number;
  out: string;
  err: string;
}

async function cli(args: string[], env: Record<string, string> = {}): Promise<Result> {
  let out = '';
  let err = '';
  const status = await runCli(args, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { SPECGARAGE_DATA_DIR: dataDir, ...env },
  });
  return { status, out, err };
}

describe('help and usage errors', () => {
  it.each([[[]], [['--help']], [['help']], [['rulepack', '--help']]])(
    'shows help for %j',
    async (args) => {
      const result = await cli(args);
      expect(result.status).toBe(0);
      expect(result.out).toContain('Usage: specgarage <command>');
      expect(result.out).toContain('internal assessments');
    },
  );

  it('rejects an unknown command with status 2', async () => {
    const result = await cli(['frobnicate']);
    expect(result.status).toBe(2);
    expect(result.err).toContain('Unknown command "frobnicate"');
  });

  it('rejects unknown options and missing arguments with status 2', async () => {
    expect((await cli(['vehicle', 'list', '--bogus'])).status).toBe(2);
    expect((await cli(['vehicle', 'add'])).status).toBe(2);
    expect((await cli(['rulepack', 'import'])).status).toBe(2);
    const missing = await cli(['inspection', 'start', '--vehicle', 'X']);
    expect(missing.status).toBe(2);
    expect(missing.err).toContain('--edition');
  });

  it('rejects stray arguments before touching any data directory', async () => {
    for (const args of [
      ['seed', 'demo', './scratch'],
      ['db', 'migrate', 'extra'],
      ['vehicle', 'list', 'extra'],
      ['rulepack', 'list', 'extra'],
      ['inspection', 'list', 'extra'],
      ['vehicle', 'add', 'CAR-1', 'CAR-2'],
      ['rulepack', 'import', 'a.json', 'b.json'],
      ['rulepack', 'validate', 'a.json', 'b.json'],
    ]) {
      const result = await cli(args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.err).toContain('Unexpected argument');
    }
    expect(existsSync(dataDir)).toBe(false);
  });

  it('rejects an empty --data-dir instead of writing to the working directory', async () => {
    for (const value of ['', '   ']) {
      const result = await cli(['db', 'migrate', `--data-dir=${value}`]);
      expect(result.status).toBe(2);
      expect(result.err).toContain('--data-dir must not be empty');
    }
    expect(existsSync(dataDir)).toBe(false);
  });

  it('reports invalid settings', async () => {
    const result = await cli(['vehicle', 'list'], { SPECGARAGE_PORT: 'abc' });
    expect(result.status).toBe(1);
    expect(result.err).toContain('SPECGARAGE_PORT');
  });
});

describe('rulepack validate', () => {
  it('summarizes a valid rulepack without touching the data directory', async () => {
    const result = await cli(['rulepack', 'validate', demoRulepackPath]);
    expect(result.status).toBe(0);
    expect(result.out).toContain(
      'Valid: DEMO-CUP 2026 2026-R1 - 2 documents (2 with files), 7 systems, 3 events, 20 requirements.',
    );
    expect(existsSync(dataDir)).toBe(false);
  });

  it('lists every problem with its location for an invalid rulepack', async () => {
    const path = join(directory, 'bad.json');
    writeFileSync(path, JSON.stringify({ schema: 'specgarage.rulepack/1' }));
    const result = await cli(['rulepack', 'validate', path]);
    expect(result.status).toBe(1);
    expect(result.err).toContain('is not a valid rulepack');
    expect(result.err).toMatch(/- category:/);
  });

  it('reports a file that does not exist', async () => {
    const result = await cli(['rulepack', 'validate', join(directory, 'nope.json')]);
    expect(result.status).toBe(1);
    expect(result.err).toContain('Cannot read');
  });
});

describe('data commands', () => {
  it('creates the database with db migrate', async () => {
    const result = await cli(['db', 'migrate']);
    expect(result.status).toBe(0);
    expect(existsSync(join(dataDir, 'specgarage.db'))).toBe(true);
  });

  it('imports a rulepack once and lists it', async () => {
    const first = await cli(['rulepack', 'import', demoRulepackPath]);
    expect(first.status).toBe(0);
    expect(first.out).toContain('Imported: DEMO-CUP 2026 2026-R1');
    expect(first.out).toContain('documents stored: 2');

    const again = await cli(['rulepack', 'import', demoRulepackPath]);
    expect(again.out).toContain('Already imported (unchanged)');

    const list = await cli(['rulepack', 'list']);
    expect(list.out).toContain('DEMO-CUP');
    expect(list.out.trim().split('\n')).toHaveLength(3);
  });

  it('says so when nothing exists yet', async () => {
    expect((await cli(['rulepack', 'list'])).out).toContain('No editions imported yet.');
    expect((await cli(['vehicle', 'list'])).out).toContain('No vehicles registered yet.');
    expect((await cli(['inspection', 'list'])).out).toContain('No inspections yet.');
  });

  it('adds vehicles, refuses duplicates and non-code names', async () => {
    expect((await cli(['vehicle', 'add', 'CAR-7'])).out).toContain('Added vehicle CAR-7');
    expect((await cli(['vehicle', 'list'])).out).toContain('CAR-7');
    const duplicate = await cli(['vehicle', 'add', 'CAR-7']);
    expect(duplicate.status).toBe(1);
    expect(duplicate.err).toContain('already exists');
    expect((await cli(['vehicle', 'add', 'Juan Perez'])).status).toBe(1);
  });

  it('starts and lists an inspection', async () => {
    await cli(['rulepack', 'import', demoRulepackPath]);
    await cli(['vehicle', 'add', 'CAR-7']);
    const started = await cli([
      'inspection',
      'start',
      '--edition',
      'DEMO-CUP/2026/2026-R1',
      '--vehicle',
      'CAR-7',
      '--event',
      'round-2',
      '--station',
      'Bay-3',
    ]);
    expect(started.status).toBe(0);
    expect(started.out).toMatch(/Started inspection [0-9a-f-]{36}/);
    const list = await cli(['inspection', 'list']);
    expect(list.out).toContain('Round 2');
    expect(list.out).toContain('DEMO-CUP 2026 2026-R1');
  });

  it('explains why an inspection cannot start', async () => {
    await cli(['rulepack', 'import', demoRulepackPath]);
    const result = await cli([
      'inspection',
      'start',
      '--edition',
      'DEMO-CUP/2026/2026-R1',
      '--vehicle',
      'NOBODY',
      '--event',
      'round-1',
      '--station',
      'Bay-1',
    ]);
    expect(result.status).toBe(1);
    expect(result.err).toContain('Add it first');
  });

  it('prefers --data-dir over the environment', async () => {
    const other = join(directory, 'other');
    await cli(['vehicle', 'add', 'CAR-1', '--data-dir', other]);
    expect(existsSync(join(other, 'specgarage.db'))).toBe(true);
    expect(existsSync(dataDir)).toBe(false);
  });
});

describe('seed demo', () => {
  it('tells the user to start the server on the same data directory when one was given', async () => {
    const other = join(directory, 'elsewhere');
    const withOverride = await cli(['seed', 'demo', '--data-dir', other]);
    expect(withOverride.out).toContain(`pnpm start --data-dir "${other}"`);
    const withoutOverride = await cli(['seed', 'demo']);
    expect(withoutOverride.out).toContain('"pnpm start".');
    expect(withoutOverride.out).not.toContain('--data-dir');
  });

  it('explains how to recover when the data directory holds an earlier version of the demo', async () => {
    // Same edition label, different content: what an older demo would have left behind.
    const older = JSON.parse(readFileSync(demoRulepackPath, 'utf8'));
    for (const document of older.documents) delete document.file;
    const path = join(directory, 'older-demo.json');
    writeFileSync(path, JSON.stringify(older));
    expect((await cli(['rulepack', 'import', path])).status).toBe(0);

    const result = await cli(['seed', 'demo']);
    expect(result.status).toBe(1);
    expect(result.err).toContain('already exists with different content');
    expect(result.err).toContain('earlier version of the demo');
    expect(result.err).toContain('new --data-dir');
  });

  it('sets up the demo category, vehicle, and inspection, and is repeatable', async () => {
    const first = await cli(['seed', 'demo']);
    expect(first.status).toBe(0);
    expect(first.out).toContain('Imported: DEMO-CUP 2026 2026-R1');
    expect(first.out).toContain('Added vehicle DEMO-01');
    const id = /Started demo inspection ([0-9a-f-]{36})/.exec(first.out)?.[1];
    expect(id).toBeDefined();
    expect(first.out).toContain(`/#/inspection/${id}`);

    const second = await cli(['seed', 'demo']);
    expect(second.out).toContain('Already imported');
    expect(second.out).not.toContain('Added vehicle');
    expect(second.out).toContain(`Existing demo inspection ${id}`);

    const list = await cli(['inspection', 'list']);
    expect(list.out.trim().split('\n')).toHaveLength(3);
  });
});
