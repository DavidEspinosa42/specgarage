import type {
  ChecklistView,
  HistoryResponse,
  InspectionSummary,
  RecordResponse,
} from './api-types.ts';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Cannot reach SpecGarage. Is the server still running?');
  }
  if (!response.ok) {
    let message = `The request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // Keep the generic message.
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  inspections: () => request<InspectionSummary[]>('/api/inspections'),
  checklist: (id: string) => request<ChecklistView>(`/api/inspections/${enc(id)}`),
  history: (id: string, key: string) =>
    request<HistoryResponse>(`/api/inspections/${enc(id)}/requirements/${enc(key)}/history`),
  record: (id: string, key: string, form: FormData) =>
    request<RecordResponse>(`/api/inspections/${enc(id)}/requirements/${enc(key)}/observations`, {
      method: 'POST',
      body: form,
    }),
  attach: (id: string, key: string, form: FormData) =>
    request<RecordResponse>(`/api/inspections/${enc(id)}/requirements/${enc(key)}/evidence`, {
      method: 'POST',
      body: form,
    }),
};

/** URL of a stored file; PDFs open at the cited page. */
export function blobUrl(sha256: string, page?: number): string {
  return `/api/blobs/${sha256}${page === undefined ? '' : `#page=${page}`}`;
}
