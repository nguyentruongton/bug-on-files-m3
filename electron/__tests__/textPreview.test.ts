import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readTextPreview,
  TEXT_PREVIEW_MAX_BYTES,
} from '../textPreview';

describe('readTextPreview', () => {
  const tempDirs: string[] = [];

  const createTempDir = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-preview-test-'));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup errors
      }
    }
    tempDirs.length = 0;
  });

  test('TEXT_PREVIEW_MAX_BYTES constant is 1048576', () => {
    expect(TEXT_PREVIEW_MAX_BYTES).toBe(1048576);
  });

  test('reads small utf-8 text file including unicode characters', async () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'sample.txt');
    const content = 'Hello world! 🌍 ✨ éàç 世界';
    fs.writeFileSync(filePath, content, 'utf-8');

    const result = await readTextPreview(filePath);
    expect(result).toEqual({ kind: 'text', content });
  });

  test('reads empty file as text with empty string content', async () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'empty.txt');
    fs.writeFileSync(filePath, '');

    const result = await readTextPreview(filePath);
    expect(result).toEqual({ kind: 'text', content: '' });
  });

  test('returns too-large when file size exceeds maxBytes', async () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'toolarge.txt');
    fs.writeFileSync(filePath, '0123456789X'); // 11 bytes

    const result = await readTextPreview(filePath, 10);
    expect(result).toEqual({ kind: 'too-large', size: 11 });
  });

  test('accepts file when file size is exactly maxBytes', async () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'exact.txt');
    const content = '0123456789'; // 10 bytes
    fs.writeFileSync(filePath, content);

    const result = await readTextPreview(filePath, 10);
    expect(result).toEqual({ kind: 'text', content });
  });

  test('detects binary file with null byte in the first 8 KB', async () => {
    const dir = createTempDir();

    // 1. Null byte at start
    const fileStart = path.join(dir, 'null-start.bin');
    fs.writeFileSync(fileStart, Buffer.from([0x00, 0x61, 0x62, 0x63]));
    expect(await readTextPreview(fileStart)).toEqual({ kind: 'binary' });

    // 2. Null byte in middle of first 8KB
    const fileMid = path.join(dir, 'null-mid.bin');
    const midBuf = Buffer.alloc(100, 0x61);
    midBuf[50] = 0x00;
    fs.writeFileSync(fileMid, midBuf);
    expect(await readTextPreview(fileMid)).toEqual({ kind: 'binary' });

    // 3. Null byte at index 8191 (8192nd byte)
    const file8191 = path.join(dir, 'null-8191.bin');
    const buf8192 = Buffer.alloc(8192, 0x61);
    buf8192[8191] = 0x00;
    fs.writeFileSync(file8191, buf8192);
    expect(await readTextPreview(file8191)).toEqual({ kind: 'binary' });
  });

  test('treats file with null byte after the first 8192 bytes as text', async () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'null-late.txt');
    const buf = Buffer.alloc(9000, 0x61); // 'a'
    buf[8192] = 0x00; // byte index 8192 is the 8193rd byte, beyond the first 8192 bytes
    fs.writeFileSync(filePath, buf);

    const result = await readTextPreview(filePath);
    expect(result.kind).toBe('text');
    if (result.kind === 'text') {
      expect(result.content.length).toBe(9000);
    }
  });

  test('returns error for missing path', async () => {
    const result = await readTextPreview('/tmp/nonexistent-file-path-404.txt');
    expect(result).toEqual({ kind: 'error' });
  });

  test('returns error for directory path', async () => {
    const dir = createTempDir();
    const result = await readTextPreview(dir);
    expect(result).toEqual({ kind: 'error' });
  });
});
