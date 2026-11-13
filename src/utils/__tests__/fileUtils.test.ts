import { describe, expect, test } from 'bun:test';
import {
  getSemanticGroup,
  isHiddenFile,
  isArchiveFile,
  isImageFile,
  isVideoFile,
  isAudioFile,
  isPdfFile,
  isTextFile,
  isVideoEntry,
  isMediaThumbnailCandidate,
  getFileIconInfo,
  formatFileSize,
  formatFileDate,
  validateFileName,
} from '../fileUtils';
import type { IFile } from '../../types/files';

function makeFile(name: string, isDirectory = false, size = 0): IFile {
  return {
    name,
    path: `/home/stark/${name}`,
    isDirectory,
    size,
    mtime: new Date('2026-11-10T14:30:00Z'),
  };
}

describe('fileUtils', () => {
  test('isHiddenFile detects dotfiles and dotfolders', () => {
    expect(isHiddenFile('.bashrc')).toBe(true);
    expect(isHiddenFile('.config')).toBe(true);
    expect(isHiddenFile('Documents')).toBe(false);
    expect(isHiddenFile('report.pdf')).toBe(false);
  });

  test('isArchiveFile detects supported archive extensions', () => {
    expect(isArchiveFile('backup.zip')).toBe(true);
    expect(isArchiveFile('source.tar.gz')).toBe(true);
    expect(isArchiveFile('data.tgz')).toBe(true);
    expect(isArchiveFile('kernel.tar.xz')).toBe(true);
    expect(isArchiveFile('archive.tar')).toBe(true);
    expect(isArchiveFile('notes.txt')).toBe(false);
  });

  test('file type predicates identify media, pdf, and text files', () => {
    expect(isImageFile('pic.PNG')).toBe(true);
    expect(isImageFile('pic.webp')).toBe(true);
    expect(isImageFile('photo.avif')).toBe(true);
    expect(isImageFile('scan.tif')).toBe(true);
    expect(isImageFile('scan.tiff')).toBe(true);
    expect(isImageFile('camera.heic')).toBe(true);
    expect(isImageFile('camera.heif')).toBe(true);
    expect(isImageFile('doc.pdf')).toBe(false);

    expect(isVideoFile('movie.mp4')).toBe(true);
    expect(isVideoFile('movie.MKV')).toBe(true);
    expect(isVideoFile('video.m4v')).toBe(true);
    expect(isVideoFile('video.flv')).toBe(true);
    expect(isVideoFile('stream.mts')).toBe(true);
    expect(isVideoFile('stream.m2ts')).toBe(true);
    expect(isVideoFile('clip.ogv')).toBe(true);
    expect(isVideoFile('clip.wmv')).toBe(true);
    expect(isVideoFile('mobile.3gp')).toBe(true);
    expect(isVideoFile('movie.mpg')).toBe(true);
    expect(isVideoFile('movie.mpeg')).toBe(true);
    expect(isVideoFile('index.ts')).toBe(false);
    expect(isVideoFile('song.mp3')).toBe(false);

    expect(isAudioFile('song.flac')).toBe(true);
    expect(isAudioFile('song.WAV')).toBe(true);
    expect(isAudioFile('movie.mp4')).toBe(false);

    expect(isPdfFile('doc.pdf')).toBe(true);
    expect(isPdfFile('DOC.PDF')).toBe(true);
    expect(isPdfFile('doc.txt')).toBe(false);

    expect(isTextFile('notes.txt')).toBe(true);
    expect(isTextFile('README.MD')).toBe(true);
    expect(isTextFile('config.toml')).toBe(true);
    expect(isTextFile('main.rs')).toBe(true);
    expect(isTextFile('package.json')).toBe(true);
    expect(isTextFile('app.log')).toBe(true);
    expect(isTextFile('photo.png')).toBe(false);
  });

  test('getFileIconInfo returns semantic icon and colorClass per file type', () => {
    expect(getFileIconInfo(makeFile('Documents', true))).toEqual({
      icon: 'folder',
      colorClass: 'folder-icon',
    });
    expect(getFileIconInfo(makeFile('photo.png'))).toEqual({
      icon: 'image',
      colorClass: 'media-icon',
    });
    expect(getFileIconInfo(makeFile('song.mp3'))).toEqual({
      icon: 'audio_file',
      colorClass: 'media-icon',
    });
    expect(getFileIconInfo(makeFile('clip.mp4'))).toEqual({
      icon: 'movie',
      colorClass: 'media-icon',
    });
    expect(getFileIconInfo({ ...makeFile('clip.ts'), mediaKind: 'video' })).toEqual({
      icon: 'movie',
      colorClass: 'media-icon',
    });
    expect(getFileIconInfo(makeFile('manual.pdf'))).toEqual({
      icon: 'picture_as_pdf',
      colorClass: 'pdf-icon',
    });
    expect(getFileIconInfo(makeFile('readme.md'))).toEqual({
      icon: 'description',
      colorClass: 'doc-icon',
    });
    expect(getFileIconInfo(makeFile('App.tsx'))).toEqual({
      icon: 'code',
      colorClass: 'code-icon',
    });
    expect(getFileIconInfo(makeFile('bundle.zip'))).toEqual({
      icon: 'folder_zip',
      colorClass: 'archive-icon',
    });
    expect(getFileIconInfo(makeFile('app.AppImage'))).toEqual({
      icon: 'terminal',
      colorClass: 'exec-icon',
    });
    expect(getFileIconInfo(makeFile('.bashrc'))).toEqual({
      icon: 'insert_drive_file',
      colorClass: 'other-icon',
    });
  });

  test('formatFileSize formats byte counts cleanly', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1572864)).toBe('1.5 MB');
  });

  test('formatFileDate returns concise readable date and handles invalid dates', () => {
    const formatted = formatFileDate(new Date('2026-11-10T14:30:00Z'));
    expect(formatted.length).toBeGreaterThan(5);
    expect(formatFileDate('invalid-date')).toBe('—');
  });

  test('validateFileName rejects empty, slash-containing, or dot-only names', () => {
    expect(validateFileName('')).toEqual({ valid: false, error: null });
    expect(validateFileName('   ')).toEqual({ valid: false, error: null });
    expect(validateFileName('foo/bar')).toEqual({
      valid: false,
      error: "Name cannot contain '/'",
    });
    expect(validateFileName('.')).toEqual({
      valid: false,
      error: "Name cannot be '.' or '..'",
    });
    expect(validateFileName('..')).toEqual({
      valid: false,
      error: "Name cannot be '.' or '..'",
    });
    expect(validateFileName('my-folder')).toEqual({ valid: true, error: null });
  });

  test('getSemanticGroup categorizes directories and files', () => {
    expect(getSemanticGroup(makeFile('Projects', true))).toBe('Folders');
    expect(getSemanticGroup(makeFile('index.ts'))).toBe('Code');
    expect(getSemanticGroup({ ...makeFile('clip.ts'), mediaKind: 'video' })).toBe('Media');
    expect(getSemanticGroup(makeFile('movie.m4v'))).toBe('Media');
    expect(getSemanticGroup(makeFile('photo.avif'))).toBe('Media');
  });

  test('isVideoEntry identifies video files and MPEG-TS mediaKind entries', () => {
    expect(isVideoEntry(makeFile('movie.mp4'))).toBe(true);
    expect(isVideoEntry(makeFile('movie.m4v'))).toBe(true);
    expect(isVideoEntry({ ...makeFile('clip.ts'), mediaKind: 'video' })).toBe(true);
    expect(isVideoEntry(makeFile('index.ts'))).toBe(false);
    expect(isVideoEntry(makeFile('photo.jpg'))).toBe(false);
    expect(isVideoEntry(makeFile('folder', true))).toBe(false);
  });

  test('isMediaThumbnailCandidate identifies images, videos, and MPEG-TS video entries', () => {
    expect(isMediaThumbnailCandidate(makeFile('photo.png'))).toBe(true);
    expect(isMediaThumbnailCandidate(makeFile('camera.heic'))).toBe(true);
    expect(isMediaThumbnailCandidate(makeFile('movie.mp4'))).toBe(true);
    expect(isMediaThumbnailCandidate({ ...makeFile('clip.ts'), mediaKind: 'video' })).toBe(true);
    expect(isMediaThumbnailCandidate(makeFile('index.ts'))).toBe(false);
    expect(isMediaThumbnailCandidate(makeFile('song.mp3'))).toBe(false);
    expect(isMediaThumbnailCandidate(makeFile('document.pdf'))).toBe(false);
    expect(isMediaThumbnailCandidate(makeFile('folder', true))).toBe(false);
  });
});
