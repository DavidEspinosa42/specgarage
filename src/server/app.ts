import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { SpecGarageError } from '../domain/errors.ts';
import { NOT_OFFICIAL_NOTICE } from '../domain/status.ts';
import {
  addEvidence,
  getChecklist,
  getHistory,
  MAX_FILES_PER_UPLOAD,
  recordObservation,
} from '../service/checklist.ts';
import type { ServiceContext } from '../service/context.ts';
import { listInspections, resolveInspection } from '../service/inspections.ts';
import { localOnly, securityHeaders } from './security.ts';
import { createStaticHandler } from './static.ts';
import { HttpError, readUpload, textField, textFields } from './uploads.ts';

export interface AppOptions {
  ctx: ServiceContext;
  maxUploadBytes: number;
  /** Directory of the built web interface. */
  webRoot: string;
}

const STATUS_FOR_CODE = { 'invalid-input': 400, 'not-found': 404, conflict: 409 } as const;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * The local HTTP API and static files for the web interface. All routes are
 * restricted to requests that originate from this computer.
 */
export function createApp(options: AppOptions): Hono {
  const { ctx, maxUploadBytes } = options;
  const app = new Hono();

  app.use('*', securityHeaders());
  app.use('*', localOnly());

  // Room for the largest allowed upload plus the form fields.
  const uploadLimit = bodyLimit({
    maxSize: maxUploadBytes * MAX_FILES_PER_UPLOAD + 1024 * 1024,
    onError: (c) =>
      c.json({ error: 'too-large', message: 'The request is larger than the upload limit.' }, 413),
  });

  app.get('/api/health', (c) => c.json({ status: 'ok', app: 'specgarage' }));

  app.get('/api/inspections', (c) => c.json(listInspections(ctx)));

  app.get('/api/inspections/:id', (c) => {
    const inspection = resolveInspection(ctx, c.req.param('id'));
    return c.json(getChecklist(ctx, inspection.id));
  });

  app.get('/api/inspections/:id/requirements/:key/history', (c) => {
    const inspection = resolveInspection(ctx, c.req.param('id'));
    return c.json({
      notice: NOT_OFFICIAL_NOTICE,
      entries: getHistory(ctx, inspection.id, c.req.param('key')),
    });
  });

  app.post('/api/inspections/:id/requirements/:key/observations', uploadLimit, async (c) => {
    const inspection = resolveInspection(ctx, c.req.param('id'));
    const { form, files } = await readUpload(c, maxUploadBytes);
    const view = recordObservation(ctx, {
      inspectionId: inspection.id,
      requirementKey: c.req.param('key'),
      value: textField(form, 'value') ?? null,
      unit: textField(form, 'unit') ?? null,
      verdict: textField(form, 'verdict') ?? null,
      confirmedConditions: textFields(form, 'conditions'),
      note: textField(form, 'note') ?? null,
      files,
    });
    return c.json({ notice: NOT_OFFICIAL_NOTICE, requirement: view }, 201);
  });

  app.post('/api/inspections/:id/requirements/:key/evidence', uploadLimit, async (c) => {
    const inspection = resolveInspection(ctx, c.req.param('id'));
    const { form, files } = await readUpload(c, maxUploadBytes);
    const observation = textField(form, 'observationId');
    if (observation === undefined || !/^[0-9]{1,12}$/.test(observation)) {
      throw new HttpError(400, 'Send the observationId the files were prepared for.');
    }
    const view = addEvidence(ctx, {
      inspectionId: inspection.id,
      requirementKey: c.req.param('key'),
      observationId: Number(observation),
      files,
    });
    return c.json({ notice: NOT_OFFICIAL_NOTICE, requirement: view }, 201);
  });

  app.get('/api/blobs/:sha256', (c) => {
    const sha256 = c.req.param('sha256');
    const blob = SHA256_PATTERN.test(sha256) ? ctx.store.getBlob(sha256) : undefined;
    if (blob === undefined || !ctx.blobs.has(sha256)) {
      return c.json({ error: 'not-found', message: 'No such file.' }, 404);
    }
    const bytes = ctx.blobs.read(sha256);
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': blob.mediaType,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${sha256.slice(0, 12)}.${EXTENSIONS[blob.mediaType] ?? 'bin'}"`,
      // Files are addressed by their hash, so a given URL never changes.
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });

  app.all('/api/*', (c) => c.json({ error: 'not-found', message: 'No such endpoint.' }, 404));
  app.get('*', createStaticHandler(options.webRoot));

  app.onError((error, c) => {
    if (error instanceof SpecGarageError) {
      return c.json(
        { error: error.code, message: error.message, details: error.details },
        STATUS_FOR_CODE[error.code],
      );
    }
    if (error instanceof HttpError) {
      return c.json(
        { error: error.status === 413 ? 'too-large' : 'bad-request', message: error.message },
        error.status,
      );
    }
    // Never leak internals to the client; the operator sees the cause on stderr.
    console.error(error);
    return c.json({ error: 'internal', message: 'Something went wrong.' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not-found', message: 'No such page.' }, 404));

  return app;
}
