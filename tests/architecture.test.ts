/**
 * Enforces the layering rules from AGENTS.md by scanning import statements:
 * domain and engine are pure, only storage touches the file system or SQLite,
 * and the CLI and server are thin front ends over the service layer.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Module specifiers imported or re-exported by a file. */
function importsOf(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  const specifiers = [
    ...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g),
  ];
  const bare = [...text.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)];
  return [...specifiers, ...bare].map((match) => match[1] ?? '');
}

const LAYERS = ['domain', 'engine', 'storage', 'service', 'server', 'cli'] as const;
type Layer = (typeof LAYERS)[number];

/** Which other layers each layer may import from. */
const ALLOWED_LAYERS: Record<Layer, readonly Layer[]> = {
  domain: ['domain'],
  engine: ['domain', 'engine'],
  storage: ['domain', 'storage'],
  service: ['domain', 'engine', 'storage', 'service'],
  server: ['domain', 'storage', 'service', 'server'],
  cli: ['domain', 'storage', 'service', 'server', 'cli'],
};

/** Node built-ins each layer may import. Anything else from `node:` is a violation. */
const ALLOWED_NODE: Record<Layer, readonly string[]> = {
  domain: ['node:crypto'],
  engine: [],
  storage: ['node:crypto', 'node:fs', 'node:path', 'node:sqlite', 'node:url'],
  service: ['node:crypto'],
  server: ['node:path', 'node:http', 'node:net'],
  cli: ['node:util', 'node:url', 'node:fs'],
};

function layerOf(path: string): Layer | null {
  const first = relative(srcRoot, path).split(/[\\/]/)[0] ?? '';
  return (LAYERS as readonly string[]).includes(first) ? (first as Layer) : null;
}

const files = sourceFiles(srcRoot).filter((path) => layerOf(path) !== null);

describe('layering', () => {
  it('finds the source files of every layer', () => {
    const found = new Set(files.map((path) => layerOf(path)));
    expect([...found].sort()).toEqual([...LAYERS].sort());
  });

  it.each(files.map((path) => [relative(srcRoot, path).replaceAll('\\', '/'), path]))(
    '%s imports only what its layer may use',
    (_name, path) => {
      const layer = layerOf(path as string);
      if (layer === null) throw new Error('unreachable');
      for (const specifier of importsOf(path as string)) {
        if (specifier.startsWith('node:')) {
          expect(ALLOWED_NODE[layer], `${layer} may not import ${specifier}`).toContain(specifier);
        } else if (specifier.startsWith('.')) {
          const target = layerOf(join(dirname(path as string), specifier));
          if (target !== null) {
            expect(ALLOWED_LAYERS[layer], `${layer} may not import from ${target}`).toContain(
              target,
            );
          }
        }
      }
    },
  );

  it('keeps the file system out of everything but storage and the process entry point', () => {
    const offenders = files
      .filter((path) => layerOf(path) !== 'storage')
      .filter((path) => importsOf(path).includes('node:fs'))
      .map((path) => relative(srcRoot, path).replaceAll('\\', '/'));
    // main.ts reads the optional .env file before anything else starts.
    expect(offenders).toEqual(['cli/main.ts']);
  });

  it('keeps SQLite inside storage', () => {
    const offenders = files
      .filter((path) => layerOf(path) !== 'storage')
      .filter((path) => importsOf(path).some((specifier) => specifier === 'node:sqlite'));
    expect(offenders).toEqual([]);
  });
});
