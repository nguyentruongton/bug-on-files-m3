import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { IFile } from '../../types/files';
import { FileList, MediaThumbnail } from '../FileList';

function makeFile(name: string, overrides: Partial<IFile> = {}): IFile {
    return {
        name,
        path: `/home/u/${name}`,
        isDirectory: false,
        size: 1024,
        mtime: new Date('2026-05-01T10:00:00Z'),
        ...overrides,
    };
}

describe('FileList media thumbnails and play badge', () => {
    test('renders lazy grid thumbnail and play badge for video and extended image candidates in list view', () => {
        const files: IFile[] = [
            makeFile('clip.mp4'),
            makeFile('photo.heic'),
            makeFile('stream.ts', { mediaKind: 'video' }),
            makeFile('doc.txt'),
            makeFile('docs', { isDirectory: true }),
        ];

        const html = renderToStaticMarkup(
            <FileList
                files={files}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );

        // Videos render thumbnail pointing to media://thumb
        expect(html).toContain('src="media://thumb/home/u/clip.mp4?size=grid"');
        expect(html).toContain('src="media://thumb/home/u/photo.heic?size=grid"');
        expect(html).toContain('src="media://thumb/home/u/stream.ts?size=grid"');

        // Lazy loading and async decoding
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('decoding="async"');

        // Play badge icon for videos
        expect(html).toContain('play_arrow');
        expect(html).toContain('pointer-events-none');

        // Non-media and directories do not render media://thumb
        expect(html).not.toContain('media://thumb/home/u/doc.txt');
        expect(html).not.toContain('media://thumb/home/u/docs');
    });

    test('renders lazy grid thumbnail and play badge for videos in grid view', () => {
        const files: IFile[] = [
            makeFile('clip.mp4'),
            makeFile('photo.heic'),
            makeFile('code.ts'),
        ];

        const html = renderToStaticMarkup(
            <FileList
                files={files}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="grid"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );

        expect(html).toContain('src="media://thumb/home/u/clip.mp4?size=grid"');
        expect(html).toContain('src="media://thumb/home/u/photo.heic?size=grid"');
        expect(html).toContain('play_arrow');
        expect(html).toContain('pointer-events-none');
        expect(html).not.toContain('media://thumb/home/u/code.ts');
    });

    test('routes video shape pair to video candidate with mediaKind: "video"', () => {
        const videoFile = makeFile('stream.ts', { mediaKind: 'video' });
        const html = renderToStaticMarkup(
            <FileList
                files={[videoFile]}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons
                groupingEnabled={false}
                sortBy="name"
                sortOrder="asc"
            />
        );

        // Video shape pair uses bg-m3-secondary-container text-m3-on-secondary-container
        expect(html).toContain('bg-m3-secondary-container text-m3-on-secondary-container');
    });
});

describe('MediaThumbnail subcomponent', () => {
    test('renders thumbnail image and play badge for video file', () => {
        const file = makeFile('video.mov');
        const html = renderToStaticMarkup(
            <MediaThumbnail
                file={file}
                iconName="movie"
                iconSize={32}
                filled
            />
        );

        expect(html).toContain('src="media://thumb/home/u/video.mov?size=grid"');
        expect(html).toContain('alt="video.mov"');
        expect(html).toContain('loading="lazy"');
        expect(html).toContain('decoding="async"');
        expect(html).toContain('play_arrow');
        expect(html).toContain('pointer-events-none');
    });

    test('renders thumbnail image without play badge for photo file', () => {
        const file = makeFile('photo.avif');
        const html = renderToStaticMarkup(
            <MediaThumbnail
                file={file}
                iconName="image"
                iconSize={32}
                filled
            />
        );

        expect(html).toContain('src="media://thumb/home/u/photo.avif?size=grid"');
        expect(html).toContain('alt="photo.avif"');
        expect(html).not.toContain('play_arrow');
    });

    test('renders fallback Icon for non-media file', () => {
        const file = makeFile('report.pdf');
        const html = renderToStaticMarkup(
            <MediaThumbnail
                file={file}
                iconName="picture_as_pdf"
                iconSize={24}
                filled={false}
            />
        );

        expect(html).not.toContain('<img');
        expect(html).toContain('picture_as_pdf');
    });

    test('renders fallback Icon instead of empty img when failed state matches file.path', () => {
        const file = makeFile('broken.mp4');
        const html = renderToStaticMarkup(
            <MediaThumbnail
                file={file}
                iconName="movie"
                iconSize={24}
                filled
                initialFailedPath="/home/u/broken.mp4"
            />
        );

        // Fallback icon must be rendered
        expect(html).toContain('movie');
        // No img tag or play badge rendered in failed state
        expect(html).not.toContain('<img');
        expect(html).not.toContain('play_arrow');
    });
});
