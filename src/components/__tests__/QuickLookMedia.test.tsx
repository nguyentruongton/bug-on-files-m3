import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IFile } from '../../types/files';
import type { VideoMetadata } from '../../api/types';
import {
    QuickLook,
    getInitialImageStage,
    getNextImageStage,
    resolveEffectiveImageStage,
    formatVideoMetadataSummary,
    resolveEffectiveVideoMetadata,
} from '../QuickLook';

function makeFile(name: string, overrides: Partial<IFile> = {}): IFile {
    return {
        name,
        path: `/home/u/${name}`,
        isDirectory: false,
        size: 1048576, // 1 MB
        mtime: new Date('2026-05-01T10:00:00Z'),
        ...overrides,
    };
}

describe('QuickLook image preview and fallback', () => {
    test('QuickLook for photo.png renders <img src="media://localhost/home/u/photo.png">', () => {
        const file = makeFile('photo.png');
        const html = renderToStaticMarkup(
            <QuickLook
                file={file}
                files={[file]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
            />
        );

        expect(html).toContain('src="media://localhost/home/u/photo.png"');
        expect(html).toContain('alt="photo.png"');
        expect(html).not.toContain('media://preview/');
    });

    test('QuickLook for photo.heic renders <img src="media://preview/home/u/photo.heic"> directly (shouldPreferPreviewUrl)', () => {
        const file = makeFile('photo.heic');
        const html = renderToStaticMarkup(
            <QuickLook
                file={file}
                files={[file]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
            />
        );

        expect(html).toContain('src="media://preview/home/u/photo.heic"');
        expect(html).toContain('alt="photo.heic"');
        expect(html).not.toContain('media://localhost/home/u/photo.heic');
    });

    test('QuickLook image falls back to preview when initial stage is preview', () => {
        const file = makeFile('unsupported.png');
        const html = renderToStaticMarkup(
            <QuickLook
                file={file}
                files={[file]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
                initialImageStageState={{ path: file.path, stage: 'preview' }}
            />
        );

        expect(html).toContain('src="media://preview/home/u/unsupported.png"');
    });

    test('QuickLook image falls back to generic "other" view when stage advances to error', () => {
        const file = makeFile('broken.png');
        const html = renderToStaticMarkup(
            <QuickLook
                file={file}
                files={[file]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
                initialImageStageState={{ path: file.path, stage: 'error' }}
            />
        );

        // When stage is 'error', previewKind becomes 'other', rendering generic file info card
        expect(html).not.toContain('<img');
        expect(html).toContain('Size: 1 MB');
        expect(html).toContain(file.path);
    });
});

describe('QuickLook video streaming & fallback card', () => {
    test('QuickLook for clip.mkv renders <video src="media://localhost/home/u/clip.mkv" poster="media://thumb/home/u/clip.mkv?size=poster" ...>', () => {
        const file = makeFile('clip.mkv');
        const html = renderToStaticMarkup(
            <QuickLook
                file={file}
                files={[file]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
            />
        );

        expect(html).toContain('<video');
        expect(html).toContain('src="media://localhost/home/u/clip.mkv"');
        expect(html).toContain('poster="media://thumb/home/u/clip.mkv?size=poster"');
        expect(html).toContain('controls=""');
    });

    test('QuickLook for MPEG-TS stream.ts with mediaKind: "video" renders video preview (NOT text)', () => {
        const file = makeFile('stream.ts', { mediaKind: 'video' });
        const html = renderToStaticMarkup(
            <QuickLook
                file={file}
                files={[file]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
            />
        );

        expect(html).toContain('<video');
        expect(html).toContain('src="media://localhost/home/u/stream.ts"');
        expect(html).toContain('poster="media://thumb/home/u/stream.ts?size=poster"');
        expect(html).not.toContain('quicklook-text-content');
        expect(html).not.toContain('Loading preview');
    });

    test('QuickLook renders video fallback card with poster, metadata pills, and Open button on playback error', () => {
        const file = makeFile('unsupported-codec.avi');
        const meta: VideoMetadata = {
            width: 1920,
            height: 1080,
            durationSeconds: 125,
            codec: 'msmpeg4v3',
        };

        const html = renderToStaticMarkup(
            <QuickLook
                file={file}
                files={[file]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
                initialVideoErrorPath={file.path}
                initialVideoMeta={{ path: file.path, data: meta }}
            />
        );

        // Fallback card displays poster image
        expect(html).toContain('src="media://thumb/home/u/unsupported-codec.avi?size=poster"');
        expect(html).toContain('Inline playback unavailable for this format');

        // Formatted metadata pills
        expect(html).toContain('1920×1080');
        expect(html).toContain('02:05');
        expect(html).toContain('MSMPEG4V3');
        expect(html).toContain('1 MB');

        // Open button in card
        expect(html).toContain('Open');
    });

    test('QuickLook video fallback card degrades gracefully to movie icon when poster thumbnail fails', () => {
        const file = makeFile('corrupted.mp4');
        const html = renderToStaticMarkup(
            <QuickLook
                file={file}
                files={[file]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
                initialVideoErrorPath={file.path}
                initialPosterErrorPath={file.path}
            />
        );

        // Does not render broken poster img
        expect(html).not.toContain('src="media://thumb/home/u/corrupted.mp4?size=poster"');
        // Renders movie icon fallback
        expect(html).toContain('movie');
        expect(html).toContain('Inline playback unavailable for this format');
    });
});

describe('QuickLook pure state helpers & transitions', () => {
    test('getInitialImageStage transitions based on shouldPreferPreviewUrl', () => {
        expect(getInitialImageStage('photo.png')).toBe('raw');
        expect(getInitialImageStage('image.jpg')).toBe('raw');
        expect(getInitialImageStage('logo.svg')).toBe('raw');
        expect(getInitialImageStage('photo.heic')).toBe('preview');
        expect(getInitialImageStage('photo.HEIC')).toBe('preview');
        expect(getInitialImageStage('scan.heif')).toBe('preview');
        expect(getInitialImageStage('picture.tif')).toBe('preview');
        expect(getInitialImageStage('document.tiff')).toBe('preview');
    });

    test('getNextImageStage transitions raw -> preview -> error cleanly', () => {
        expect(getNextImageStage('raw')).toBe('preview');
        expect(getNextImageStage('preview')).toBe('error');
        expect(getNextImageStage('error')).toBe('error');
    });

    test('resolveEffectiveImageStage resets per file.path without leaking previous error state', () => {
        const fileA = makeFile('a.png');
        const fileB = makeFile('b.png');
        const fileHeic = makeFile('c.heic');

        // Initial with no stored state
        expect(resolveEffectiveImageStage(null, fileA)).toBe('raw');
        expect(resolveEffectiveImageStage(null, fileHeic)).toBe('preview');

        // Matching path uses stored stage
        expect(resolveEffectiveImageStage({ path: fileA.path, stage: 'preview' }, fileA)).toBe('preview');
        expect(resolveEffectiveImageStage({ path: fileA.path, stage: 'error' }, fileA)).toBe('error');

        // Stale path from fileA ignored when inspecting fileB
        expect(resolveEffectiveImageStage({ path: fileA.path, stage: 'error' }, fileB)).toBe('raw');
        expect(resolveEffectiveImageStage({ path: fileA.path, stage: 'error' }, fileHeic)).toBe('preview');
    });

    test('formatVideoMetadataSummary formats resolution, duration, codec, and size without throwing on partial/null metadata', () => {
        const full = formatVideoMetadataSummary(
            { width: 1920, height: 1080, durationSeconds: 125, codec: 'h264' },
            1048576
        );
        expect(full.resolution).toBe('1920×1080');
        expect(full.duration).toBe('02:05');
        expect(full.codec).toBe('H264');
        expect(full.size).toBe('1 MB');
        expect(full.pills).toEqual(['1920×1080', '02:05', 'H264', '1 MB']);

        // Partial metadata with missing duration and codec
        const partial = formatVideoMetadataSummary(
            { width: 3840, height: 2160, durationSeconds: null, codec: null },
            50000000
        );
        expect(partial.resolution).toBe('3840×2160');
        expect(partial.duration).toBeNull();
        expect(partial.codec).toBeNull();
        expect(partial.pills).toContain('3840×2160');

        // Completely null metadata
        const empty = formatVideoMetadataSummary(null, null);
        expect(empty.resolution).toBeNull();
        expect(empty.duration).toBeNull();
        expect(empty.codec).toBeNull();
        expect(empty.size).toBeNull();
        expect(empty.pills).toEqual([]);
    });

    test('Stale-response guard: resolveEffectiveVideoMetadata ignores metadata belonging to previous path', () => {
        const fileA = makeFile('clipA.mp4');
        const fileB = makeFile('clipB.mkv');
        const metaA: VideoMetadata = { width: 1920, height: 1080, durationSeconds: 60, codec: 'h264' };

        // Matching path resolves metadata
        expect(resolveEffectiveVideoMetadata({ path: fileA.path, data: metaA }, fileA.path)).toEqual(metaA);

        // Mismatched path returns null
        expect(resolveEffectiveVideoMetadata({ path: fileA.path, data: metaA }, fileB.path)).toBeNull();

        // Null videoMeta returns null
        expect(resolveEffectiveVideoMetadata(null, fileA.path)).toBeNull();
    });

    test('QuickLook stale-response guard: switching file.path ignores metadata belonging to previous path in UI', () => {
        const fileB = makeFile('clipB.mkv');
        const staleMeta: VideoMetadata = {
            width: 3840,
            height: 2160,
            durationSeconds: 999,
            codec: 'hevc',
        };

        const html = renderToStaticMarkup(
            <QuickLook
                file={fileB}
                files={[fileB]}
                onClose={() => {}}
                onNavigate={() => {}}
                onOpen={() => {}}
                initialVideoErrorPath={fileB.path}
                // Stale metadata associated with /home/u/clipA.mp4, not clipB.mkv
                initialVideoMeta={{ path: '/home/u/clipA.mp4', data: staleMeta }}
            />
        );

        // Stale pills must NOT appear in the UI for clipB
        expect(html).not.toContain('3840×2160');
        expect(html).not.toContain('HEVC');
    });
});
