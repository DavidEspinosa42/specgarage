import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import { importEdition } from '../../src/service/editions.ts';
import { addVehicle, startInspection } from '../../src/service/inspections.ts';
import { loadRulepackFile } from '../../src/storage/rulepack-file.ts';
import { createTestEnvironment, demoRulepackPath, type TestEnvironment } from '../helpers.ts';

let env: TestEnvironment;
let app: Hono;
let webRoot: string;
let inspectionId: string;
const MAX_UPLOAD = 1024; // bytes, small so size limits are easy to exercise

beforeEach(() => {
  env = createTestEnvironment();
  webRoot = join(env.directory, 'web');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>SpecGarage</title>');
  writeFileSync(join(webRoot, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(webRoot, 'notes.txt'), 'not a served type');
  writeFileSync(join(env.directory, 'secret.txt'), 'top secret');

  importEdition(env.ctx, loadRulepackFile(demoRulepackPath));
  addVehicle(env.ctx, 'DEMO-01');
  inspectionId = startInspection(env.ctx, {
    edition: 'COPA-DEMO/2026/2026-R1',
    vehicleCode: 'DEMO-01',
    eventKey: 'fecha-1',
    stationLabel: 'Bay-1',
  }).id;
  app = createApp({ ctx: env.ctx, maxUploadBytes: MAX_UPLOAD, webRoot });
});
afterEach(() => {
  vi.restoreAllMocks();
  env.cleanup();
});

const LOCAL = '127.0.0.1:8787';

function call(path: string, init: RequestInit = {}, headers: Record<string, string> = {}) {
  return app.request(`http://${LOCAL}${path}`, {
    ...init,
    headers: { Host: LOCAL, ...(init.headers as Record<string, string>), ...headers },
  });
}

const jpeg = (n = 0) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, n]);

interface RequirementBody {
  status: string;
  current: { id: number; value: string; evidence: { kind: string; sha256: string }[] };
}

/** Reads a result-bearing response, which must carry the not-official notice. */
async function requirementOf(response: Response): Promise<RequirementBody> {
  const body = (await response.json()) as { notice: string; requirement: RequirementBody };
  expect(body.notice).toMatch(/not an official/);
  return body.requirement;
}

function form(fields: Record<string, string | string[]>, files: Uint8Array[] = []): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  }
  for (const [index, bytes] of files.entries()) {
    data.append(
      'files',
      new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
      `photo-${index}.jpg`,
    );
  }
  return data;
}

const post = (path: string, body: FormData, headers: Record<string, string> = {}) =>
  call(path, { method: 'POST', body }, { Origin: `http://${LOCAL}`, ...headers });

const TRACK = `/api/inspections/${'{id}'}/requirements/chasis-trocha-delantera-max`;
const trackPath = (suffix: string) => TRACK.replace('{id}', inspectionId) + suffix;

describe('local-only guard', () => {
  it.each([
    ['evil.example', 'a foreign host'],
    ['evil.example:8787', 'a foreign host with a port'],
    ['127.0.0.1.evil.example', 'a host that merely starts with 127.0.0.1'],
    ['localhost.evil.example', 'a host that merely starts with localhost'],
    ['192.168.1.20:8787', 'a LAN address'],
    ['0.0.0.0:8787', 'the unspecified address'],
    ['', 'an empty host'],
  ])('rejects %s (%s)', async (host) => {
    const response = await call('/api/health', {}, { Host: host });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'forbidden' });
  });

  it('rejects a request with no Host header at all', async () => {
    const response = await app.request('http://127.0.0.1:8787/api/health');
    expect(response.status).toBe(403);
  });

  it.each([
    '127.0.0.1',
    '127.0.0.1:8787',
    'localhost',
    'localhost:3000',
    '[::1]',
    '[::1]:8787',
    'LOCALHOST:8787',
  ])('accepts the local host %s', async (host) => {
    expect((await call('/api/health', {}, { Host: host })).status).toBe(200);
  });

  it.each([
    'https://evil.example',
    'http://evil.example:8787',
    'http://127.0.0.1.evil.example',
    'null',
    'not a url',
    'https://127.0.0.1:8787',
  ])('rejects the cross-site Origin %s, for reads and writes', async (origin) => {
    expect((await call('/api/inspections', {}, { Origin: origin })).status).toBe(403);
    const write = await post(trackPath('/observations'), form({ verdict: 'undetermined' }), {
      Origin: origin,
    });
    expect(write.status).toBe(403);
    expect(env.ctx.store.currentObservations(inspectionId).size).toBe(0);
  });

  it('accepts local Origins', async () => {
    for (const origin of ['http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787']) {
      expect((await call('/api/health', {}, { Origin: origin })).status).toBe(200);
    }
  });

  it.each(['cross-site', 'same-site'])('rejects Sec-Fetch-Site: %s', async (site) => {
    expect((await call('/api/health', {}, { 'Sec-Fetch-Site': site })).status).toBe(403);
  });

  it.each(['same-origin', 'none'])('accepts Sec-Fetch-Site: %s', async (site) => {
    expect((await call('/api/health', {}, { 'Sec-Fetch-Site': site })).status).toBe(200);
  });

  it('also protects static files and unknown paths', async () => {
    expect((await call('/', {}, { Host: 'evil.example' })).status).toBe(403);
    expect((await call('/nothing', {}, { Host: 'evil.example' })).status).toBe(403);
  });
});

describe('response headers', () => {
  it('adds security headers and a strict Content-Security-Policy to API and pages', async () => {
    for (const path of ['/api/health', '/', '/api/nope']) {
      const response = await call(path);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
    }
  });
});

describe('reading', () => {
  it('reports health', async () => {
    expect(await (await call('/api/health')).json()).toEqual({ status: 'ok', app: 'specgarage' });
  });

  it('lists inspections', async () => {
    const list = (await (await call('/api/inspections')).json()) as {
      id: string;
      vehicleCode: string;
    }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: inspectionId, vehicleCode: 'DEMO-01' });
  });

  it('returns the checklist by full id or prefix', async () => {
    for (const reference of [inspectionId, inspectionId.slice(0, 8)]) {
      const response = await call(`/api/inspections/${reference}`);
      expect(response.status).toBe(200);
      const view = (await response.json()) as {
        systems: unknown[];
        counts: { pending: number };
        notice: string;
      };
      expect(view.systems).toHaveLength(7);
      expect(view.counts.pending).toBe(20);
      expect(view.notice).toMatch(/not an official/);
    }
  });

  it('answers errors with JSON and the right status', async () => {
    const unknown = await call('/api/inspections/ffffffff');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: 'not-found' });
    expect((await call('/api/inspections/xyz')).status).toBe(400);
    expect(
      (await call(trackPath('/history').replace('chasis-trocha-delantera-max', 'nope'))).status,
    ).toBe(404);
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api/inspections', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('recording', () => {
  const measure = (
    value: string,
    files: Uint8Array[],
    extra: Record<string, string | string[]> = {},
  ) =>
    post(
      trackPath('/observations'),
      form({ value, unit: 'mm', conditions: ['reposo-plano'], ...extra }, files),
    );

  it('records a measurement with a photo and returns the judged requirement', async () => {
    const response = await measure('1658', [jpeg()]);
    expect(response.status).toBe(201);
    const view = await requirementOf(response);
    expect(view.status).toBe('compliant');
    expect(view.current.value).toBe('1658');
    expect(view.current.evidence).toHaveLength(1);
    expect(view.current.evidence[0]?.kind).toBe('photo');
  });

  it('is Non-Compliant above the limit and Unverifiable without evidence', async () => {
    expect((await requirementOf(await measure('1661', [jpeg()]))).status).toBe('non-compliant');
    expect((await requirementOf(await measure('1658', []))).status).toBe('unverifiable');
  });

  it('records a manual verdict', async () => {
    const response = await post(
      `/api/inspections/${inspectionId}/requirements/seguridad-extintor/observations`,
      form({ verdict: 'pass' }, [jpeg()]),
    );
    expect((await requirementOf(response)).status).toBe('compliant');
  });

  it('explains invalid input and records nothing', async () => {
    const comma = await measure('1658,5', []);
    expect(comma.status).toBe(400);
    expect(((await comma.json()) as { message: string }).message).toMatch(
      /dot as the decimal separator/,
    );
    expect((await measure('5', [], { unit: 'm' })).status).toBe(400);
    expect((await measure('5', [jpeg(), new TextEncoder().encode('not an image')])).status).toBe(
      400,
    );
    expect((await measure('5', [], { conditions: ['nope'] })).status).toBe(400);
    expect(env.ctx.store.currentObservations(inspectionId).size).toBe(0);
  });

  it('answers an unknown requirement with 404', async () => {
    const response = await post(
      `/api/inspections/${inspectionId}/requirements/nope/observations`,
      form({ verdict: 'pass' }),
    );
    expect(response.status).toBe(404);
  });

  it('requires multipart form data', async () => {
    const json = await call(
      trackPath('/observations'),
      { method: 'POST', body: JSON.stringify({ value: '1' }) },
      { Origin: `http://${LOCAL}`, 'Content-Type': 'application/json' },
    );
    expect(json.status).toBe(415);
  });

  it('rejects a malformed multipart body', async () => {
    const response = await call(
      trackPath('/observations'),
      { method: 'POST', body: 'this is not multipart' },
      { Origin: `http://${LOCAL}`, 'Content-Type': 'multipart/form-data; boundary=xyz' },
    );
    expect(response.status).toBe(400);
  });

  it('rejects text sent in the files field and files sent in text fields', async () => {
    const asText = new FormData();
    asText.append('verdict', 'pass');
    asText.append('files', 'just text');
    expect((await post(trackPath('/observations'), asText)).status).toBe(400);

    const asFile = new FormData();
    asFile.append('value', new Blob(['1658']), 'value.txt');
    expect((await post(trackPath('/observations'), asFile)).status).toBe(400);
  });

  it('enforces the upload size limit per file', async () => {
    const big = new Uint8Array(MAX_UPLOAD + 1);
    big.set([0xff, 0xd8, 0xff]);
    const response = await measure('5', [big]);
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toBe('too-large');
    expect(env.ctx.store.currentObservations(inspectionId).size).toBe(0);
  });

  it('enforces the overall request size limit', async () => {
    const huge = new Uint8Array(1024 * 1024 * 12);
    const response = await call(
      trackPath('/observations'),
      { method: 'POST', body: huge },
      { Origin: `http://${LOCAL}`, 'Content-Type': 'multipart/form-data; boundary=xyz' },
    );
    expect(response.status).toBe(413);
  });

  it('limits the number of files', async () => {
    const files = Array.from({ length: 11 }, (_, n) => jpeg(n));
    const response = await measure('5', files);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toMatch(/At most 10 files/);
  });

  it('ignores the empty file part that browsers send when no file is chosen', async () => {
    const data = form({ value: '1658', unit: 'mm', conditions: ['reposo-plano'] });
    data.append('files', new File([], ''));
    expect((await post(trackPath('/observations'), data)).status).toBe(201);
  });
});

describe('evidence and history', () => {
  const recordTrack = async (value: string, files: Uint8Array[] = []) =>
    requirementOf(
      await post(
        trackPath('/observations'),
        form({ value, unit: 'mm', conditions: ['reposo-plano'] }, files),
      ),
    );

  it('attaches more evidence to the observation the files were prepared for', async () => {
    const recorded = await recordTrack('1658');
    const response = await post(
      trackPath('/evidence'),
      form({ observationId: String(recorded.current.id) }, [jpeg()]),
    );
    expect(response.status).toBe(201);
    expect((await requirementOf(response)).status).toBe('compliant');
  });

  it('answers 409 when there is no observation yet', async () => {
    const response = await post(trackPath('/evidence'), form({ observationId: '1' }, [jpeg()]));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { message: string }).message).toMatch(
      /Record a measurement/,
    );
  });

  it('requires a well-formed observationId', async () => {
    await recordTrack('1658');
    const invalid: Record<string, string>[] = [
      {},
      { observationId: 'abc' },
      { observationId: '-1' },
      { observationId: '1.5' },
    ];
    for (const fields of invalid) {
      const response = await post(trackPath('/evidence'), form(fields, [jpeg()]));
      expect(response.status, JSON.stringify(fields)).toBe(400);
    }
  });

  it('refuses evidence prepared for a superseded observation, so it cannot attach to the newer one', async () => {
    const first = await recordTrack('1661');
    const second = await recordTrack('1658');
    expect(second.current.id).not.toBe(first.current.id);

    const late = await post(
      trackPath('/evidence'),
      form({ observationId: String(first.current.id) }, [jpeg(5)]),
    );
    expect(late.status).toBe(409);
    expect(((await late.json()) as { message: string }).message).toMatch(/recorded again/);

    const view = (await (await call(`/api/inspections/${inspectionId}`)).json()) as {
      systems: { requirements: { key: string; status: string }[] }[];
    };
    const track = view.systems
      .flatMap((s) => s.requirements)
      .find((r) => r.key === 'chasis-trocha-delantera-max');
    expect(track?.status).toBe('unverifiable');
  });

  it('returns the history oldest first', async () => {
    const fields = { unit: 'mm', conditions: ['reposo-plano'] };
    await post(trackPath('/observations'), form({ ...fields, value: '1661' }, [jpeg()]));
    await post(trackPath('/observations'), form({ ...fields, value: '1658' }, [jpeg(1)]));
    const body = (await (await call(trackPath('/history'))).json()) as {
      notice: string;
      entries: { observation: { value: string }; results: { status: string }[] }[];
    };
    expect(body.notice).toMatch(/not an official/);
    const history = body.entries;
    expect(history.map((entry) => entry.observation.value)).toEqual(['1661', '1658']);
    expect(history.map((entry) => entry.results[0]?.status)).toEqual([
      'non-compliant',
      'compliant',
    ]);
  });
});

describe('stored files', () => {
  async function evidenceHash(): Promise<string> {
    const response = await post(
      trackPath('/observations'),
      form({ value: '1658', unit: 'mm', conditions: ['reposo-plano'] }, [jpeg(7)]),
    );
    const view = await requirementOf(response);
    return view.current.evidence[0]?.sha256 ?? '';
  }

  it('serves an evidence file with its detected type and without a Content-Security-Policy', async () => {
    const sha = await evidenceHash();
    const response = await call(`/api/blobs/${sha}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(response.headers.get('content-disposition')).toMatch(
      /inline; filename="[0-9a-f]{12}\.jpg"/,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg(7));
  });

  it('serves the regulation PDFs linked from the checklist', async () => {
    const view = (await (await call(`/api/inspections/${inspectionId}`)).json()) as {
      systems: { requirements: { sources: { fileSha256: string | null }[] }[] }[];
    };
    const sha = view.systems[0]?.requirements[0]?.sources[0]?.fileSha256 ?? '';
    const response = await call(`/api/blobs/${sha}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  });

  it.each(['nothex', '..%2F..%2Fsecret.txt', 'A'.repeat(64), '0'.repeat(64), '0'.repeat(63)])(
    'answers 404 for the unknown or malformed hash %s',
    async (hash) => {
      expect((await call(`/api/blobs/${hash}`)).status).toBe(404);
    },
  );

  it('answers 404 when a recorded file has gone missing from disk', async () => {
    const sha = await evidenceHash();
    rmSync(env.ctx.blobs.pathFor(sha));
    expect((await call(`/api/blobs/${sha}`)).status).toBe(404);
  });
});

describe('static files', () => {
  it('serves the page without caching and hashed assets as immutable', async () => {
    const page = await call('/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const asset = await call('/assets/app-abc123.js');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
  });

  it.each([
    '/../secret.txt',
    '/%2e%2e/secret.txt',
    '/..%2Fsecret.txt',
    '/assets/../../secret.txt',
    '/assets/%2e%2e/%2e%2e/secret.txt',
    '/..\\secret.txt',
    '/%00',
    '/assets//app-abc123.js',
    '/notes.txt',
    '/missing.js',
  ])('does not serve %s', async (path) => {
    const response = await call(path);
    expect([400, 404]).toContain(response.status);
    expect(await response.text()).not.toContain('top secret');
  });

  it('explains when the interface has not been built', async () => {
    const bare = createApp({
      ctx: env.ctx,
      maxUploadBytes: MAX_UPLOAD,
      webRoot: join(env.directory, 'missing'),
    });
    const response = await bare.request(`http://${LOCAL}/`, { headers: { Host: LOCAL } });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('pnpm build');
  });
});

describe('internal errors', () => {
  it('returns a generic message and keeps details out of the response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(env.ctx.store, 'listInspections').mockImplementation(() => {
      throw new Error('boom at C:\\Users\\someone\\secret.db');
    });
    const response = await call('/api/inspections');
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'internal', message: 'Something went wrong.' });
    expect(text).not.toContain('secret.db');
    expect(log).toHaveBeenCalled();
  });
});
