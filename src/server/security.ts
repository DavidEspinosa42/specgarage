import type { MiddlewareHandler } from 'hono';

/**
 * Hosts that may be used to reach the server. The server only listens on the
 * loopback interface, but a web page on another site can still make a
 * browser send requests to it (cross-site requests, or DNS rebinding where a
 * hostile name resolves to 127.0.0.1). Checking the Host and Origin headers
 * stops both.
 */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Extracts the hostname from a Host header value, dropping any port. */
function hostnameOf(host: string): string | null {
  const match = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::[0-9]{1,5})?$/.exec(host);
  return match?.[1]?.toLowerCase() ?? null;
}

export function isLocalHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const hostname = hostnameOf(host);
  return hostname !== null && LOCAL_HOSTNAMES.has(hostname);
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Rejects any request that does not come from a page served by this server. */
export function localOnly(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('origin');
    const site = c.req.header('sec-fetch-site');
    const allowed =
      isLocalHost(c.req.header('host')) &&
      (origin === undefined || isLocalOrigin(origin)) &&
      (site === undefined || site === 'same-origin' || site === 'none');
    if (!allowed) {
      return c.json(
        { error: 'forbidden', message: 'This server only accepts requests from this computer.' },
        403,
      );
    }
    await next();
  };
}

const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Security headers for every response. Stored files (`/api/blobs/`) skip the
 * Content-Security-Policy because browsers' built-in PDF viewers do not work
 * under a restrictive one; they are limited to four signature-verified types
 * and served with `nosniff`.
 */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    if (!c.req.path.startsWith('/api/blobs/')) {
      c.header('Content-Security-Policy', PAGE_CSP);
    }
  };
}
