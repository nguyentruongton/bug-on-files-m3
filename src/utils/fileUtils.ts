import type { IFile } from '../types/files';

export type FileGroup = 'Folders' | 'Code' | 'Media' | 'Documents' | 'Archives' | 'Executables' | 'Others';

export const GROUP_ORDER: FileGroup[] = [
    'Folders',
    'Media',
    'Documents',
    'Code',
    'Archives',
    'Executables',
    'Others'
];

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov']);
const DOC_EXTENSIONS = new Set([
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'csv'
]);
const CODE_EXTENSIONS = new Set([
    'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'cs',
    'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml', 'sql', 'sh', 'bash',
    'php', 'rb', 'go', 'rs', 'lua'
]);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'tar', 'gz', 'xz', 'tgz', '7z', 'rar', 'iso']);
const EXTRACTABLE_EXTENSIONS = ['.zip', '.tar', '.gz', '.xz', '.tgz'];
const EXEC_EXTENSIONS = new Set(['exe', 'appimage', 'deb', 'rpm', 'apk']);

export function getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === filename.length - 1) {
        return '';
    }
    return filename.slice(lastDot + 1).toLowerCase();
}

export function isHiddenFile(filename: string): boolean {
    return filename.startsWith('.');
}

export function isImageFile(filename: string): boolean {
    return IMAGE_EXTENSIONS.has(getFileExtension(filename));
}

export function isArchiveFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return EXTRACTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function getSemanticGroup(file: IFile): FileGroup {
    if (file.isDirectory) return 'Folders';

    const ext = getFileExtension(file.name);
    if (!ext) return 'Others';

    if (IMAGE_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) {
        return 'Media';
    }
    if (DOC_EXTENSIONS.has(ext)) {
        return 'Documents';
    }
    if (CODE_EXTENSIONS.has(ext)) {
        return 'Code';
    }
    if (ARCHIVE_EXTENSIONS.has(ext)) {
        return 'Archives';
    }
    if (EXEC_EXTENSIONS.has(ext)) {
        return 'Executables';
    }
    return 'Others';
}

export interface FileIconInfo {
    icon: string;
    colorClass: string;
}

export function getFileIconInfo(file: IFile): FileIconInfo {
    if (file.isDirectory) {
        return { icon: 'folder', colorClass: 'folder-icon' };
    }

    const ext = getFileExtension(file.name);
    if (IMAGE_EXTENSIONS.has(ext)) {
        return { icon: 'image', colorClass: 'media-icon' };
    }
    if (AUDIO_EXTENSIONS.has(ext)) {
        return { icon: 'audio_file', colorClass: 'media-icon' };
    }
    if (VIDEO_EXTENSIONS.has(ext)) {
        return { icon: 'movie', colorClass: 'media-icon' };
    }
    if (ext === 'pdf') {
        return { icon: 'picture_as_pdf', colorClass: 'pdf-icon' };
    }
    if (DOC_EXTENSIONS.has(ext)) {
        return { icon: 'description', colorClass: 'doc-icon' };
    }
    if (CODE_EXTENSIONS.has(ext)) {
        return { icon: 'code', colorClass: 'code-icon' };
    }
    if (ARCHIVE_EXTENSIONS.has(ext)) {
        return { icon: 'folder_zip', colorClass: 'archive-icon' };
    }
    if (EXEC_EXTENSIONS.has(ext)) {
        return { icon: 'terminal', colorClass: 'exec-icon' };
    }

    return { icon: 'insert_drive_file', colorClass: 'other-icon' };
}

export function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatFileDate(mtime: Date | string | number | undefined | null): string {
    if (mtime === undefined || mtime === null) return '—';
    const date = mtime instanceof Date ? mtime : new Date(mtime);
    if (Number.isNaN(date.getTime())) return '—';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function validateFileName(rawName: string): { valid: boolean; error: string | null } {
    const trimmed = rawName.trim();
    if (!trimmed) {
        return { valid: false, error: null };
    }
    if (trimmed.includes('/')) {
        return { valid: false, error: "Name cannot contain '/'" };
    }
    if (trimmed === '.' || trimmed === '..') {
        return { valid: false, error: "Name cannot be '.' or '..'" };
    }
    return { valid: true, error: null };
}
