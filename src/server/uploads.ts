import type { Context } from 'hono';
import { SpecGarageError } from '../domain/errors.ts';
import { MAX_FILES_PER_UPLOAD } from '../service/checklist.ts';

export class HttpError extends Error {
  readonly status: 400 | 413 | 415;

  constructor(status: 400 | 413 | 415, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface Upload {
  form: FormData;
  files: Uint8Array[];
}

/** Reads a text field that may be absent; anything but plain text is rejected. */
export function textField(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  if (value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `The field "${name}" must be text.`);
  return value;
}

export function textFields(form: FormData, name: string): string[] {
  return form.getAll(name).map((value) => {
    if (typeof value !== 'string') throw new HttpError(400, `The field "${name}" must be text.`);
    return value;
  });
}

/**
 * Reads a multipart request. File count and size are checked before any file
 * is read into memory.
 */
export async function readUpload(c: Context, maxUploadBytes: number): Promise<Upload> {
  const type = c.req.header('content-type') ?? '';
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'Send the request as multipart/form-data.');
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new HttpError(400, 'The request body is not valid multipart form data.');
  }

  const entries = form.getAll('files');
  if (entries.length > MAX_FILES_PER_UPLOAD) {
    throw new SpecGarageError(
      'invalid-input',
      `At most ${MAX_FILES_PER_UPLOAD} files can be attached at once.`,
    );
  }
  const files: Uint8Array[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      // An empty file input can arrive as an empty text part; anything else is a mistake.
      if (entry === '') continue;
      throw new HttpError(400, 'The field "files" must contain files.');
    }
    // Browsers send an empty part when no file is chosen; ignore it.
    if (entry.size === 0 && entry.name === '') continue;
    if (entry.size > maxUploadBytes) {
      throw new HttpError(
        413,
        `A file is larger than the limit of ${Math.floor(maxUploadBytes / 1024 / 1024)} MB.`,
      );
    }
    files.push(new Uint8Array(await entry.arrayBuffer()));
  }
  return { form, files };
}
