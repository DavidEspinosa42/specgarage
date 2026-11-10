import type { EvidenceKind } from './rulepack.ts';

/**
 * File types are decided by their leading bytes, never by file name or any
 * type declared by the sender.
 */
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

function startsWith(data: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (data.length < offset + signature.length) return false;
  return signature.every((byte, index) => data[offset + index] === byte);
}

/** Returns the detected media type, or null when the bytes are not a supported file. */
export function detectMediaType(data: Uint8Array): MediaType | null {
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  // "RIFF" <4-byte size> "WEBP"
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  if (startsWith(data, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // "%PDF-"
  return null;
}

/** Images are photos; PDFs are documents. */
export function evidenceKindFor(mediaType: MediaType): EvidenceKind {
  return mediaType === 'application/pdf' ? 'document' : 'photo';
}
