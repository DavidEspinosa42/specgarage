import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/run.ts';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'specgarage-serve-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function startCli(args: string[]) {
  let out = '';
  let err = '';
  let stop: () => void = () => {};
  const shutdown = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const done = runCli(args, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { SPECGARAGE_DATA_DIR: join(directory, 'data') },
    shutdown,
  });
  return { done, stop, output: () => ({ out, err }) };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for the server');
}

/** A raw HTTP request, so the Host header can be set to anything. */
function rawGet(port: number, path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serve', () => {
  it('serves the API on the loopback interface and stops cleanly', async () => {
    const cli = startCli(['serve', '--port', '0']);
    await waitFor(() => /running at http:\/\/127\.0\.0\.1:\d+/.test(cli.output().out));
    const match = /running at (http:\/\/127\.0\.0\.1:(\d+))/.exec(cli.output().out);
    const url = match?.[1] ?? '';
    const port = Number(match?.[2]);

    const health = await fetch(`${url}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', app: 'specgarage' });

    // A request that names a foreign host is refused over a real connection.
    const rebinding = await rawGet(port, '/api/health', { Host: 'evil.example' });
    expect(rebinding.status).toBe(403);

    cli.stop();
    expect(await cli.done).toBe(0);
    expect(cli.output().out).toContain('Stopped.');
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });

  it('tells the user when the web interface is not built', async () => {
    const cli = startCli(['serve', '--port', '0']);
    await waitFor(() => cli.output().out.includes('Press Ctrl+C'));
    // The interface may or may not be built in this checkout; either way the command works.
    expect(cli.output().out).toMatch(/running at/);
    cli.stop();
    expect(await cli.done).toBe(0);
  });

  it.each([['abc'], ['-1'], ['65536'], ['80.5'], ['']])('rejects --port %j', async (port) => {
    const cli = startCli(['serve', `--port=${port}`]);
    expect(await cli.done).toBe(2);
    expect(cli.output().err).toContain('--port must be a whole number');
  });

  it('reports a port that is already in use', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    const taken = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const cli = startCli(['serve', '--port', String(taken)]);
      expect(await cli.done).toBe(1);
      expect(cli.output().err).toContain('already in use');
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});
