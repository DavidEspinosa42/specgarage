import { SpecGarageError } from './domain/errors.ts';

export interface Config {
  /** Directory holding the database and stored files. */
  dataDir: string;
  /** Port of the local web server. The server always binds to 127.0.0.1. */
  port: number;
  /** Largest accepted upload, in bytes. */
  maxUploadBytes: number;
}

type Environment = Readonly<Record<string, string | undefined>>;

function integerSetting(
  env: Environment,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[0-9]{1,9}$/.test(raw)) {
    throw new SpecGarageError('invalid-input', `${name} must be a whole number (got "${raw}").`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new SpecGarageError(
      'invalid-input',
      `${name} must be between ${min} and ${max} (got ${value}).`,
    );
  }
  return value;
}

/** Reads settings from environment variables, with documented defaults. */
export function loadConfig(env: Environment): Config {
  const dataDir = env.SPECGARAGE_DATA_DIR;
  return {
    dataDir: dataDir === undefined || dataDir === '' ? './data' : dataDir,
    port: integerSetting(env, 'SPECGARAGE_PORT', 8787, 1, 65535),
    maxUploadBytes: integerSetting(env, 'SPECGARAGE_MAX_UPLOAD_MB', 15, 1, 200) * 1024 * 1024,
  };
}
