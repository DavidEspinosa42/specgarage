import { extname } from 'node:path';
import type { Handler } from 'hono';
import { readWebAsset, webAssetsExist } from '../storage/web-assets.ts';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Serves the built web interface. This only maps URLs to relative paths and
 * known content types; reading files, and keeping them inside the directory,
 * is the storage layer's job.
 */
export function createStaticHandler(root: string): Handler {
  return (c) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text('Bad request.', 400);
    }
    if (pathname.includes('\0') || pathname.includes('\\')) return c.text('Bad request.', 400);

    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const type = CONTENT_TYPES[extname(relativePath).toLowerCase()];
    const body = type === undefined ? undefined : readWebAsset(root, relativePath);

    if (body === undefined || type === undefined) {
      if (pathname === '/' && !webAssetsExist(root)) {
        return c.text('The web interface has not been built. Run "pnpm build" first.', 503);
      }
      return c.text('Not found.', 404);
    }
    const hashed = relativePath.startsWith('assets/');
    return c.body(new Uint8Array(body), 200, {
      'Content-Type': type,
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  };
}
