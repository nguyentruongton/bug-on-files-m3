import type { IFile } from '../types/files';
import type { VideoMetadata } from '../api/types';
import {
    encodePath,
    formatFileSize,
    getFileExtension,
    isImageFile,
    isVideoFile,
    isAudioFile,
    isPdfFile,
    isTextFile,
} from './fileUtils';

export type ImageStage = 'raw' | 'preview' | 'error';

export interface VideoMetadataSummary {
    resolution: string | null;
    duration: string | null;
    codec: string | null;
    size: string | null;
    pills: string[];
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'folder' | 'other';

const PREVIEW_PREFERRED_EXTENSIONS = new Set(['heic', 'heif', 'tif', 'tiff']);

export function getPreviewKind(file: IFile): PreviewKind {
    if (file.isDirectory) {
        return 'folder';
    }
    if (file.mediaKind === 'video') {
        return 'video';
    }
    const name = file.name;
    if (isImageFile(name)) return 'image';
    if (isVideoFile(name)) return 'video';
    if (isAudioFile(name)) return 'audio';
    if (isPdfFile(name)) return 'pdf';
    if (isTextFile(name)) return 'text';
    return 'other';
}

export function toMediaUrl(path: string): string {
    return `media://localhost${encodePath(path)}`;
}

export function toThumbnailUrl(path: string, size: 'grid' | 'poster' = 'grid'): string {
    return `media://thumb${encodePath(path)}?size=${size}`;
}

export function toPreviewUrl(path: string): string {
    return `media://preview${encodePath(path)}`;
}

export function shouldPreferPreviewUrl(filename: string): boolean {
    return PREVIEW_PREFERRED_EXTENSIONS.has(getFileExtension(filename));
}

export function formatVideoDuration(seconds: number | null | undefined): string | null {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
        return null;
    }
    const totalSeconds = Math.floor(seconds);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (h > 0) {
        return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
}

export function stepIndex(index: number, length: number, delta: number): number {
    if (length <= 0) {
        return -1;
    }
    const next = index + delta;
    return Math.max(0, Math.min(length - 1, next));
}

export function resolveQuickLookTarget(
    selectedFiles: Set<string>,
    lastSelectedPath: string | null,
    sortedFiles: IFile[]
): IFile | null {
    if (selectedFiles.size === 0) {
        return null;
    }
    if (lastSelectedPath && selectedFiles.has(lastSelectedPath)) {
        const found = sortedFiles.find((f) => f.path === lastSelectedPath);
        if (found) return found;
    }
    const firstSelected = sortedFiles.find((f) => selectedFiles.has(f.path));
    return firstSelected ?? null;
}

export function resolveSpaceQuickLookTarget(
    selectedFiles: Set<string>,
    lastSelectedPath: string | null,
    sortedFiles: IFile[],
    activeElement?: Element | null
): IFile | null {
    if (selectedFiles.size > 0) {
        return resolveQuickLookTarget(selectedFiles, lastSelectedPath, sortedFiles);
    }
    const focusedPath = (activeElement as HTMLElement | null)
        ?.closest?.('.file-list-item')
        ?.getAttribute('data-file-path');
    if (!focusedPath) {
        return null;
    }
    return sortedFiles.find((f) => f.path === focusedPath) ?? null;
}

export function resolveQuickLookFallback(
    prevPath: string,
    prevFiles: IFile[],
    newFiles: IFile[]
): IFile | null {
    if (newFiles.length === 0) {
        return null;
    }
    const stillPresent = newFiles.find((f) => f.path === prevPath);
    if (stillPresent) {
        return stillPresent;
    }
    const prevIndex = prevFiles.findIndex((f) => f.path === prevPath);
    if (prevIndex === -1) {
        return newFiles[0];
    }
    const clampedIndex = Math.min(prevIndex, newFiles.length - 1);
    return newFiles[clampedIndex];
}

export function getArrowStepDelta(key: string, viewMode: 'grid' | 'list'): number | null {
    if (key === 'ArrowLeft') return -1;
    if (key === 'ArrowRight') return 1;
    if (viewMode === 'list') {
        if (key === 'ArrowUp') return -1;
        if (key === 'ArrowDown') return 1;
    }
    return null;
}

export function getInitialImageStage(filename: string): 'raw' | 'preview' {
    return shouldPreferPreviewUrl(filename) ? 'preview' : 'raw';
}

export function getNextImageStage(stage: ImageStage): ImageStage {
    if (stage === 'raw') return 'preview';
    return 'error';
}

export function resolveEffectiveImageStage(
    imageStageState: { path: string; stage: ImageStage } | null,
    file: Pick<IFile, 'path' | 'name'>
): ImageStage {
    if (imageStageState?.path === file.path) {
        return imageStageState.stage;
    }
    return getInitialImageStage(file.name);
}

export function formatVideoMetadataSummary(
    meta: VideoMetadata | null | undefined,
    fileSize?: number | null
): VideoMetadataSummary {
    const resolution =
        meta?.width && meta?.height ? `${meta.width}×${meta.height}` : null;
    const duration = formatVideoDuration(meta?.durationSeconds);
    const codec = meta?.codec ? meta.codec.toUpperCase() : null;
    const size = fileSize !== undefined && fileSize !== null ? formatFileSize(fileSize) : null;

    const pills: string[] = [];
    if (resolution) pills.push(resolution);
    if (duration) pills.push(duration);
    if (codec) pills.push(codec);
    if (size) pills.push(size);

    return { resolution, duration, codec, size, pills };
}

export function resolveEffectiveVideoMetadata(
    videoMeta: { path: string; data: VideoMetadata | null } | null,
    currentPath: string
): VideoMetadata | null {
    return videoMeta?.path === currentPath ? videoMeta.data : null;
}

