import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWebAsset, webAssetsExist } from '../../src/storage/web-assets.ts';

let directory: string;
let root: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'specgarage-web-'));
  root = join(directory, 'web');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<html></html>');
  writeFileSync(join(root, 'assets', 'app.js'), 'x');
  writeFileSync(join(directory, 'secret.txt'), 'top secret');
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('webAssetsExist', () => {
  it('is true only when index.html is present', () => {
    expect(webAssetsExist(root)).toBe(true);
    expect(webAssetsExist(join(directory, 'missing'))).toBe(false);
    expect(webAssetsExist(join(root, 'assets'))).toBe(false);
  });
});

describe('readWebAsset', () => {
  it('reads files inside the directory', () => {
    expect(readWebAsset(root, 'index.html')?.toString()).toBe('<html></html>');
    expect(readWebAsset(root, 'assets/app.js')?.toString()).toBe('x');
  });

  it.each([
    '',
    '../secret.txt',
    'assets/../../secret.txt',
    '/index.html',
    'assets//app.js',
    './index.html',
    '..\\secret.txt',
    'assets\\app.js',
    'index.html\0',
    'assets',
    'assets/',
    'missing.js',
  ])('refuses %j', (path) => {
    expect(readWebAsset(root, path)).toBeUndefined();
  });

  it('returns nothing when the directory does not exist', () => {
    expect(readWebAsset(join(directory, 'nope'), 'index.html')).toBeUndefined();
  });
});
