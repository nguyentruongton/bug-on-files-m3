import { describe, expect, test } from 'bun:test';
import type { IFile } from '../../types/files';
import {
  getPreviewKind,
  toMediaUrl,
  toThumbnailUrl,
  toPreviewUrl,
  shouldPreferPreviewUrl,
  formatVideoDuration,
  stepIndex,
  resolveQuickLookTarget,
  resolveQuickLookFallback,
  getArrowStepDelta,
} from '../quickLook';

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

    test('treats MPEG-TS files with mediaKind: video as video while normal .ts is text', () => {
      expect(getPreviewKind({ ...makeFile('stream.ts'), mediaKind: 'video' })).toBe('video');
      expect(getPreviewKind(makeFile('app.ts'))).toBe('text');
    });

    test('recognizes extended image and video extensions', () => {
      expect(getPreviewKind(makeFile('photo.avif'))).toBe('image');
      expect(getPreviewKind(makeFile('photo.heic'))).toBe('image');
      expect(getPreviewKind(makeFile('movie.m4v'))).toBe('video');
      expect(getPreviewKind(makeFile('stream.mts'))).toBe('video');
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
      expect(toMediaUrl('/home/u/a b#1?.png')).toBe('media://localhost/home/u/a%20b%231%3F.png');
      expect(toMediaUrl('/home/u/100% test.png')).toBe('media://localhost/home/u/100%25%20test.png');
    });

    test('supports unicode filenames and round-trips via decodeURIComponent', () => {
      const originalPath = '/home/u/ünï.png';
      const mediaUrl = toMediaUrl(originalPath);
      expect(mediaUrl.startsWith('media://localhost/')).toBe(true);
      const afterPrefix = mediaUrl.slice('media://localhost'.length);
      expect(decodeURIComponent(afterPrefix)).toBe(originalPath);
    });

    test('encodes segments cleanly without mangling directory separators', () => {
      const originalPath = '/home/user/My Photos/summer#2026/beach 1?.jpg';
      const mediaUrl = toMediaUrl(originalPath);
      expect(mediaUrl.startsWith('media://localhost/')).toBe(true);
      expect(decodeURIComponent(mediaUrl.slice('media://localhost'.length))).toBe(originalPath);
    });
  });

  describe('toThumbnailUrl and toPreviewUrl', () => {
    test('toThumbnailUrl constructs thumbnail URL with size query parameter', () => {
      expect(toThumbnailUrl('/home/u/a b#1?.mp4', 'grid')).toBe(
        'media://thumb/home/u/a%20b%231%3F.mp4?size=grid'
      );
      expect(toThumbnailUrl('/home/u/a.mkv', 'poster')).toBe(
        'media://thumb/home/u/a.mkv?size=poster'
      );
      expect(toThumbnailUrl('/home/u/clip.mp4')).toBe(
        'media://thumb/home/u/clip.mp4?size=grid'
      );
    });

    test('toPreviewUrl constructs preview URL for high-res images', () => {
      expect(toPreviewUrl('/home/u/a.heic')).toBe('media://preview/home/u/a.heic');
      expect(toPreviewUrl('/home/u/photo with space#1.tif')).toBe(
        'media://preview/home/u/photo%20with%20space%231.tif'
      );
    });
  });

  describe('shouldPreferPreviewUrl', () => {
    test('returns true for formats that need high-res converted preview (heic, heif, tif, tiff)', () => {
      expect(shouldPreferPreviewUrl('photo.HEIC')).toBe(true);
      expect(shouldPreferPreviewUrl('photo.heif')).toBe(true);
      expect(shouldPreferPreviewUrl('scan.tif')).toBe(true);
      expect(shouldPreferPreviewUrl('scan.tiff')).toBe(true);
    });

    test('returns false for web-native and non-image formats', () => {
      expect(shouldPreferPreviewUrl('pic.png')).toBe(false);
      expect(shouldPreferPreviewUrl('photo.jpg')).toBe(false);
      expect(shouldPreferPreviewUrl('vector.svg')).toBe(false);
      expect(shouldPreferPreviewUrl('video.mp4')).toBe(false);
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

  describe('resolveQuickLookTarget', () => {
    const fileA = makeFile('a.txt');
    const fileB = makeFile('b.png');
    const fileC = makeFile('c.pdf');
    const sorted = [fileA, fileB, fileC];

    test('returns null when selectedFiles is empty', () => {
      expect(resolveQuickLookTarget(new Set(), null, sorted)).toBeNull();
      expect(resolveQuickLookTarget(new Set(), fileA.path, sorted)).toBeNull();
    });

    test('returns lastSelectedPath file if present in selection and sortedFiles', () => {
      const selected = new Set([fileA.path, fileB.path]);
      expect(resolveQuickLookTarget(selected, fileB.path, sorted)).toEqual(fileB);
      expect(resolveQuickLookTarget(selected, fileA.path, sorted)).toEqual(fileA);
    });

    test('falls back to first selected file in sortedFiles order if lastSelectedPath is null or missing', () => {
      const selected = new Set([fileC.path, fileB.path]);
      // sorted order is fileA, fileB, fileC, so fileB comes first in sortedFiles
      expect(resolveQuickLookTarget(selected, null, sorted)).toEqual(fileB);
      expect(resolveQuickLookTarget(selected, '/nonexistent', sorted)).toEqual(fileB);
    });

    test('returns null if selected files are not visible in sortedFiles', () => {
      const selected = new Set(['/other/hidden.txt']);
      expect(resolveQuickLookTarget(selected, '/other/hidden.txt', sorted)).toBeNull();
    });
  });

  describe('resolveQuickLookFallback', () => {
    const fileA = makeFile('a.txt');
    const fileB = makeFile('b.png');
    const fileC = makeFile('c.pdf');
    const fileD = makeFile('d.mp4');

    test('returns unchanged file if still present in newFiles', () => {
      const prev = [fileA, fileB, fileC];
      const next = [fileA, fileB, fileC];
      expect(resolveQuickLookFallback(fileB.path, prev, next)).toEqual(fileB);
    });

    test('moves to next neighbour (item shifting into position) when middle item is deleted', () => {
      const prev = [fileA, fileB, fileC, fileD];
      const next = [fileA, fileC, fileD]; // fileB deleted
      expect(resolveQuickLookFallback(fileB.path, prev, next)).toEqual(fileC);
    });

    test('moves to previous neighbour (new last item) when last item is deleted', () => {
      const prev = [fileA, fileB, fileC, fileD];
      const next = [fileA, fileB, fileC]; // fileD deleted
      expect(resolveQuickLookFallback(fileD.path, prev, next)).toEqual(fileC);
    });

    test('moves to new first item when first item is deleted', () => {
      const prev = [fileA, fileB, fileC];
      const next = [fileB, fileC]; // fileA deleted
      expect(resolveQuickLookFallback(fileA.path, prev, next)).toEqual(fileB);
    });

    test('returns null when all files were deleted (newFiles is empty)', () => {
      const prev = [fileA];
      const next: IFile[] = [];
      expect(resolveQuickLookFallback(fileA.path, prev, next)).toBeNull();
    });

    test('falls back to newFiles[0] if prevPath was not in prevFiles', () => {
      const prev = [fileA];
      const next = [fileB, fileC];
      expect(resolveQuickLookFallback('/unknown', prev, next)).toEqual(fileB);
    });
  });

  describe('getArrowStepDelta', () => {
    test('ArrowLeft and ArrowRight navigate in both list and grid view', () => {
      expect(getArrowStepDelta('ArrowLeft', 'grid')).toBe(-1);
      expect(getArrowStepDelta('ArrowLeft', 'list')).toBe(-1);
      expect(getArrowStepDelta('ArrowRight', 'grid')).toBe(1);
      expect(getArrowStepDelta('ArrowRight', 'list')).toBe(1);
    });

    test('ArrowUp and ArrowDown navigate in list view only', () => {
      expect(getArrowStepDelta('ArrowUp', 'list')).toBe(-1);
      expect(getArrowStepDelta('ArrowDown', 'list')).toBe(1);
      expect(getArrowStepDelta('ArrowUp', 'grid')).toBeNull();
      expect(getArrowStepDelta('ArrowDown', 'grid')).toBeNull();
    });

    test('other keys return null', () => {
      expect(getArrowStepDelta('Enter', 'list')).toBeNull();
      expect(getArrowStepDelta('Space', 'grid')).toBeNull();
      expect(getArrowStepDelta('Tab', 'list')).toBeNull();
    });
  });

  describe('formatVideoDuration', () => {
    test('formats MM:SS when under 1 hour', () => {
      expect(formatVideoDuration(125)).toBe('02:05');
      expect(formatVideoDuration(0)).toBe('00:00');
      expect(formatVideoDuration(59)).toBe('00:59');
    });

    test('formats H:MM:SS when 1 hour or more', () => {
      expect(formatVideoDuration(3661)).toBe('1:01:01');
      expect(formatVideoDuration(7200)).toBe('2:00:00');
      expect(formatVideoDuration(36000)).toBe('10:00:00');
    });

    test('returns null for null, undefined, negative, or invalid values', () => {
      expect(formatVideoDuration(null)).toBeNull();
      expect(formatVideoDuration(undefined)).toBeNull();
      expect(formatVideoDuration(-10)).toBeNull();
      expect(formatVideoDuration(NaN)).toBeNull();
    });
  });
});
