import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { SpecGarageError } from '../src/domain/errors.ts';

describe('loadConfig', () => {
  it('uses documented defaults', () => {
    expect(loadConfig({})).toEqual({
      dataDir: './data',
      port: 8787,
      maxUploadBytes: 15 * 1024 * 1024,
    });
  });

  it('treats empty values as unset', () => {
    expect(
      loadConfig({ SPECGARAGE_DATA_DIR: '', SPECGARAGE_PORT: '', SPECGARAGE_MAX_UPLOAD_MB: '' }),
    ).toEqual(loadConfig({}));
  });

  it('reads overrides', () => {
    expect(
      loadConfig({
        SPECGARAGE_DATA_DIR: '/tmp/x',
        SPECGARAGE_PORT: '9000',
        SPECGARAGE_MAX_UPLOAD_MB: '5',
      }),
    ).toEqual({ dataDir: '/tmp/x', port: 9000, maxUploadBytes: 5 * 1024 * 1024 });
  });

  it.each([
    ['SPECGARAGE_PORT', 'abc'],
    ['SPECGARAGE_PORT', '80.5'],
    ['SPECGARAGE_PORT', '-1'],
    ['SPECGARAGE_PORT', '0'],
    ['SPECGARAGE_PORT', '70000'],
    ['SPECGARAGE_MAX_UPLOAD_MB', '0'],
    ['SPECGARAGE_MAX_UPLOAD_MB', '1000'],
    ['SPECGARAGE_MAX_UPLOAD_MB', '1e3'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(SpecGarageError);
  });
});
