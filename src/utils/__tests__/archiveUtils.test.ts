import { describe, expect, test } from 'bun:test';
import {
    buildDefaultArchiveName,
    getArchiveStem,
    isPasswordArchiveError,
    parseMissingToolError,
    resolveNonCollidingArchivePath,
} from '../archiveUtils';

describe('archiveUtils', () => {
    describe('getArchiveStem', () => {
        test('strips compound and single archive extensions case-insensitively', () => {
            expect(getArchiveStem('movie.tar.gz')).toBe('movie');
            expect(getArchiveStem('kernel.tar.xz')).toBe('kernel');
            expect(getArchiveStem('backup.rar')).toBe('backup');
            expect(getArchiveStem('archive.TGZ')).toBe('archive');
            expect(getArchiveStem('photos.ZIP')).toBe('photos');
            expect(getArchiveStem('bundle.tar')).toBe('bundle');
            expect(getArchiveStem('log.gz')).toBe('log');
            expect(getArchiveStem('data.xz')).toBe('data');
            expect(getArchiveStem('package.7z')).toBe('package');
            expect(getArchiveStem('distro.iso')).toBe('distro');
        });

        test('returns filename unchanged when extension is not a known archive', () => {
            expect(getArchiveStem('notes.txt')).toBe('notes.txt');
            expect(getArchiveStem('README')).toBe('README');
        });
    });

    describe('parseMissingToolError', () => {
        test('parses raw MISSING_TOOL JSON payload', () => {
            const msg =
                'MISSING_TOOL:{"tool":"unrar","package":"unrar","distroName":"Arch Linux","installCommand":"sudo pacman -S unrar"}';
            expect(parseMissingToolError(msg)).toEqual({
                tool: 'unrar',
                package: 'unrar',
                distroName: 'Arch Linux',
                installCommand: 'sudo pacman -S unrar',
            });
        });

        test('parses Electron IPC-wrapped MISSING_TOOL error message', () => {
            const msg =
                "Error invoking remote method 'fs:extract': Error: MISSING_TOOL:{\"tool\":\"zip\",\"package\":\"zip\",\"distroName\":\"Ubuntu 24.04\",\"installCommand\":\"sudo apt update && sudo apt install zip\"}";
            expect(parseMissingToolError(msg)).toEqual({
                tool: 'zip',
                package: 'zip',
                distroName: 'Ubuntu 24.04',
                installCommand: 'sudo apt update && sudo apt install zip',
            });
        });

        test('returns null for normal or malformed error messages', () => {
            expect(parseMissingToolError('Permission denied')).toBeNull();
            expect(parseMissingToolError('MISSING_TOOL:{not valid json')).toBeNull();
            expect(parseMissingToolError('MISSING_TOOL:{"tool":"unrar"}')).toBeNull();
        });
    });

    describe('isPasswordArchiveError', () => {
        test('detects ARCHIVE_PASSWORD_REQUIRED in raw and wrapped errors', () => {
            expect(isPasswordArchiveError('ARCHIVE_PASSWORD_REQUIRED: archive is encrypted')).toBe(true);
            expect(
                isPasswordArchiveError(
                    "Error invoking remote method 'fs:extract': Error: ARCHIVE_PASSWORD_REQUIRED"
                )
            ).toBe(true);
            expect(isPasswordArchiveError('Corrupt archive')).toBe(false);
        });
    });

    describe('buildDefaultArchiveName', () => {
        test('uses base name for a single file', () => {
            expect(
                buildDefaultArchiveName([{ name: 'notes.txt', isDirectory: false }], 'Documents')
            ).toBe('notes');
            expect(
                buildDefaultArchiveName([{ name: 'report.final.pdf', isDirectory: false }], 'Documents')
            ).toBe('report.final');
            expect(
                buildDefaultArchiveName([{ name: '.gitignore', isDirectory: false }], 'repo')
            ).toBe('.gitignore');
        });

        test('uses full name for a single directory', () => {
            expect(
                buildDefaultArchiveName([{ name: 'docs', isDirectory: true }], 'Home')
            ).toBe('docs');
            expect(
                buildDefaultArchiveName([{ name: 'v1.2.0', isDirectory: true }], 'Releases')
            ).toBe('v1.2.0');
        });

        test('uses parentDirName for multiple items', () => {
            expect(
                buildDefaultArchiveName(
                    [
                        { name: 'a.txt', isDirectory: false },
                        { name: 'b', isDirectory: true },
                    ],
                    'Downloads'
                )
            ).toBe('Downloads');
        });

        test('falls back to "archive" when multiple items have empty parentDirName', () => {
            expect(
                buildDefaultArchiveName(
                    [
                        { name: 'a.txt', isDirectory: false },
                        { name: 'b.txt', isDirectory: false },
                    ],
                    ''
                )
            ).toBe('archive');
        });
    });

    describe('resolveNonCollidingArchivePath', () => {
        test('returns initial path when no collision exists', async () => {
            const existing = new Set<string>();
            const res = await resolveNonCollidingArchivePath(
                '/home/user',
                'foo.zip',
                'zip',
                async (p) => existing.has(p)
            );
            expect(res).toBe('/home/user/foo.zip');
        });

        test('increments .zip collision to foo (2).zip', async () => {
            const existing = new Set(['/home/user/foo.zip']);
            const res = await resolveNonCollidingArchivePath(
                '/home/user',
                'foo.zip',
                'zip',
                async (p) => existing.has(p)
            );
            expect(res).toBe('/home/user/foo (2).zip');
        });

        test('increments .tar.gz collision to foo (2).tar.gz preserving compound extension', async () => {
            const existing = new Set(['/home/user/foo.tar.gz']);
            const res = await resolveNonCollidingArchivePath(
                '/home/user',
                'foo.tar.gz',
                'tar.gz',
                async (p) => existing.has(p)
            );
            expect(res).toBe('/home/user/foo (2).tar.gz');
        });

        test('skips taken (2) and resolves to (3)', async () => {
            const existing = new Set([
                '/home/user/foo.zip',
                '/home/user/foo (2).zip',
            ]);
            const res = await resolveNonCollidingArchivePath(
                '/home/user/',
                'foo.zip',
                'zip',
                async (p) => existing.has(p)
            );
            expect(res).toBe('/home/user/foo (3).zip');
        });
    });
});
