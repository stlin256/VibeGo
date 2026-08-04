import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

export interface StaticWebOptions {
  readonly rootDir: string;
  readonly maxFileBytes?: number;
}

/**
 * Serves only an already-built Web directory. Returning false leaves the
 * request to the daemon API/router; static hosting never handles `/api` or
 * `/health`, so those routes retain their existing authentication boundary.
 */
export async function serveStaticWeb(request: IncomingMessage, response: ServerResponse, options?: StaticWebOptions): Promise<boolean> {
  if (!options) return false;

  const rawPath = new URL(request.url ?? '/', 'http://loopback.invalid').pathname;
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    writeStaticError(response, 400, 'WEB_ASSET_PATH_INVALID', 'The Web asset path is invalid.');
    return true;
  }
  if (!pathname.startsWith('/') || CONTROL_CHARACTERS.test(pathname) || pathname.includes('\\')) {
    writeStaticError(response, 400, 'WEB_ASSET_PATH_INVALID', 'The Web asset path is invalid.');
    return true;
  }
  if (pathname === '/health' || pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    writeStaticError(response, 405, 'WEB_STATIC_METHOD_NOT_ALLOWED', 'GET or HEAD required.', { Allow: 'GET, HEAD' });
    return true;
  }
  if (!isAbsolute(options.rootDir)) {
    writeStaticError(response, 503, 'WEB_ASSETS_UNAVAILABLE', 'Built Web assets are unavailable.');
    return true;
  }

  const maxFileBytes = boundedMaxFileBytes(options.maxFileBytes);
  let rootDir: string;
  try {
    rootDir = await realpath(resolve(options.rootDir));
    const rootInfo = await stat(rootDir);
    if (!rootInfo.isDirectory()) throw new Error('not a directory');
  } catch {
    writeStaticError(response, 503, 'WEB_ASSETS_UNAVAILABLE', 'Built Web assets are unavailable.');
    return true;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  let file = await resolveStaticFile(rootDir, requestedPath, maxFileBytes);
  if (file.kind === 'invalid' || file.kind === 'forbidden') {
    writeStaticError(response, 404, 'WEB_ASSET_NOT_FOUND', 'Web asset was not found.');
    return true;
  }
  if (file.kind === 'too-large') {
    writeStaticError(response, 413, 'WEB_ASSET_TOO_LARGE', 'Web asset exceeded the size limit.');
    return true;
  }
  if (file.kind !== 'file' && isExtensionlessRoute(pathname)) {
    file = await resolveStaticFile(rootDir, '/index.html', maxFileBytes);
  }
  if (file.kind === 'too-large') {
    writeStaticError(response, 413, 'WEB_ASSET_TOO_LARGE', 'Web asset exceeded the size limit.');
    return true;
  }
  if (file.kind !== 'file') {
    writeStaticError(response, 404, 'WEB_ASSET_NOT_FOUND', 'Web asset was not found.');
    return true;
  }

  const cacheControl = requestedPath === '/index.html' || file.path.endsWith(`${sep}index.html`)
    ? 'no-store'
    : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  const headers = {
    'Cache-Control': cacheControl,
    'Content-Length': String(file.bytes),
    'Content-Type': contentType(file.path),
    'X-Content-Type-Options': 'nosniff',
  };
  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  const stream = createReadStream(file.path);
  stream.once('error', () => {
    if (!response.writableEnded) response.destroy();
  });
  stream.pipe(response);
  return true;
}

type StaticFile =
  | { readonly kind: 'file'; readonly path: string; readonly bytes: number }
  | { readonly kind: 'missing' | 'directory' | 'invalid' | 'forbidden' | 'too-large' };

async function resolveStaticFile(rootDir: string, pathname: string, maxFileBytes: number): Promise<StaticFile> {
  const relativePath = pathname.slice(1).replaceAll('/', sep);
  const candidate = resolve(rootDir, relativePath);
  const candidateRelative = relative(rootDir, candidate);
  if (candidateRelative === '..' || candidateRelative.startsWith(`..${sep}`) || isAbsolute(candidateRelative)) return { kind: 'invalid' };
  let actual: string;
  try {
    actual = await realpath(candidate);
  } catch {
    return { kind: 'missing' };
  }
  const actualRelative = relative(rootDir, actual);
  if (actualRelative === '..' || actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative)) return { kind: 'forbidden' };
  try {
    const info = await stat(actual);
    if (info.isDirectory()) return { kind: 'directory' };
    if (!info.isFile()) return { kind: 'missing' };
    if (!Number.isSafeInteger(info.size) || info.size > maxFileBytes) return { kind: 'too-large' };
    return { kind: 'file', path: actual, bytes: info.size };
  } catch {
    return { kind: 'missing' };
  }
}

function isExtensionlessRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

function contentType(pathname: string): string {
  return CONTENT_TYPES[extname(pathname).toLowerCase()] ?? 'application/octet-stream';
}

function boundedMaxFileBytes(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? Math.min(value, 64 * 1024 * 1024)
    : DEFAULT_MAX_FILE_BYTES;
}

function writeStaticError(response: ServerResponse, statusCode: number, code: string, message: string, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify({ error: { code, message } }));
}
