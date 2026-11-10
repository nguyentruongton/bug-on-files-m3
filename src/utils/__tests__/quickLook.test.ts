import { describe, expect, test } from 'bun:test';
import type { IFile } from '../../types/files';
import { getPreviewKind, toMediaUrl, stepIndex } from '../quickLook';

function makeFile(name: string, isDirectory = false): IFile {
  return {
    name,
    path: `/home/u/${name}`,
    isDirectory,
    size: 100,
    mtime: new Date('2026-11-10T14:30:00Z'),
  };
}

describe('quickLook', () => {
  describe('getPreviewKind', () => {
    test('categorizes files by extension and respects directory flag', () => {
      expect(getPreviewKind(makeFile('a.PNG'))).toBe('image');
      expect(getPreviewKind(makeFile('a.mkv'))).toBe('video');
      expect(getPreviewKind(makeFile('a.flac'))).toBe('audio');
      expect(getPreviewKind(makeFile('a.pdf'))).toBe('pdf');
      expect(getPreviewKind(makeFile('a.ts'))).toBe('text');
      expect(getPreviewKind(makeFile('a.xyz'))).toBe('other');
      expect(getPreviewKind(makeFile('x.png', true))).toBe('folder');
    });

    test('categorizes various text and code extensions', () => {
      expect(getPreviewKind(makeFile('notes.txt'))).toBe('text');
      expect(getPreviewKind(makeFile('README.md'))).toBe('text');
      expect(getPreviewKind(makeFile('data.csv'))).toBe('text');
      expect(getPreviewKind(makeFile('app.log'))).toBe('text');
      expect(getPreviewKind(makeFile('nginx.conf'))).toBe('text');
      expect(getPreviewKind(makeFile('config.ini'))).toBe('text');
      expect(getPreviewKind(makeFile('Cargo.toml'))).toBe('text');
      expect(getPreviewKind(makeFile('package.json'))).toBe('text');
      expect(getPreviewKind(makeFile('main.py'))).toBe('text');
      expect(getPreviewKind(makeFile('index.html'))).toBe('text');
      expect(getPreviewKind(makeFile('styles.css'))).toBe('text');
    });
  });

  describe('toMediaUrl', () => {
    test('encodes special characters including spaces, #, ?, and %', () => {
      expect(toMediaUrl('/home/u/a b#1?.png')).toBe('media:///home/u/a%20b%231%3F.png');
      expect(toMediaUrl('/home/u/100% test.png')).toBe('media:///home/u/100%25%20test.png');
    });

    test('supports unicode filenames and round-trips via decodeURIComponent', () => {
      const originalPath = '/home/u/ünï.png';
      const mediaUrl = toMediaUrl(originalPath);
      expect(mediaUrl.startsWith('media://')).toBe(true);
      const afterScheme = mediaUrl.slice('media://'.length);
      expect(decodeURIComponent(afterScheme)).toBe(originalPath);
    });

    test('encodes segments cleanly without mangling directory separators', () => {
      const originalPath = '/home/user/My Photos/summer#2026/beach 1?.jpg';
      const mediaUrl = toMediaUrl(originalPath);
      expect(mediaUrl.startsWith('media:///')).toBe(true);
      expect(decodeURIComponent(mediaUrl.slice('media://'.length))).toBe(originalPath);
    });
  });

  describe('stepIndex', () => {
    test('clamps stepping within [0, length - 1]', () => {
      expect(stepIndex(0, 5, -1)).toBe(0);
      expect(stepIndex(4, 5, 1)).toBe(4);
      expect(stepIndex(2, 5, 1)).toBe(3);
      expect(stepIndex(2, 5, -1)).toBe(1);
    });

    test('returns -1 when length is 0 or negative', () => {
      expect(stepIndex(0, 0, 1)).toBe(-1);
      expect(stepIndex(0, -1, 1)).toBe(-1);
    });
  });
});
