import { describe, expect, test } from 'bun:test';
import {
  getSemanticGroup,
  isHiddenFile,
  isArchiveFile,
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
  });
});
