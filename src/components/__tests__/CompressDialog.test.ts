import { describe, expect, test } from 'bun:test';
import { resolveCompressFilename } from '../../utils/archiveUtils';

describe('resolveCompressFilename', () => {
  test('appends .zip when not present', () => {
    expect(resolveCompressFilename('backup', 'zip')).toBe('backup.zip');
    expect(resolveCompressFilename('  my archive  ', 'zip')).toBe('my archive.zip');
  });

  test('does not double .zip extension (case-insensitive)', () => {
    expect(resolveCompressFilename('backup.zip', 'zip')).toBe('backup.zip');
    expect(resolveCompressFilename('backup.ZIP', 'zip')).toBe('backup.ZIP');
  });

  test('appends .tar.gz when not present', () => {
    expect(resolveCompressFilename('release', 'tar.gz')).toBe('release.tar.gz');
  });

  test('does not double .tar.gz extension (case-insensitive)', () => {
    expect(resolveCompressFilename('release.tar.gz', 'tar.gz')).toBe('release.tar.gz');
    expect(resolveCompressFilename('release.TAR.GZ', 'tar.gz')).toBe('release.TAR.GZ');
  });
});
