import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Whether the built web interface is present in the directory. */
export function webAssetsExist(root: string): boolean {
  return existsSync(join(resolve(root), 'index.html'));
}

/**
 * Reads one file of the built web interface. The path must be relative, use
 * "/" separators, and stay inside the directory (symbolic links included);
 * anything else, and anything that is not a regular file, yields undefined.
 */
export function readWebAsset(root: string, relativePath: string): Buffer | undefined {
  if (
    relativePath === '' ||
    relativePath.includes('\0') ||
    relativePath.includes('\\') ||
    relativePath.startsWith('/') ||
    relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  try {
    const base = realpathSync(resolve(root));
    const target = realpathSync(join(base, relativePath));
    const outside = relative(base, target);
    if (
      outside === '' ||
      outside === '..' ||
      outside.startsWith(`..${sep}`) ||
      isAbsolute(outside)
    ) {
      return undefined;
    }
    return statSync(target).isFile() ? readFileSync(target) : undefined;
  } catch {
    return undefined;
  }
}
