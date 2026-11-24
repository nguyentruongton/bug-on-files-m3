export interface MissingToolInfo {
    tool: string;
    package: string;
    distroName: string;
    installCommand: string;
}

const ARCHIVE_STEM_EXTENSIONS = [
    '.tar.gz',
    '.tar.xz',
    '.tgz',
    '.zip',
    '.rar',
    '.tar',
    '.gz',
    '.xz',
    '.7z',
    '.iso',
] as const;

const MISSING_TOOL_MARKER = 'MISSING_TOOL:';

/** Strip known archive extensions (case-insensitively, compound extensions first). */
export function getArchiveStem(filename: string): string {
    const lower = filename.toLowerCase();
    for (const ext of ARCHIVE_STEM_EXTENSIONS) {
        if (lower.endsWith(ext) && filename.length > ext.length) {
            return filename.slice(0, filename.length - ext.length);
        }
    }
    return filename;
}

/** Extract structured missing-tool metadata from raw or IPC-wrapped error messages. */
export function parseMissingToolError(message: string): MissingToolInfo | null {
    if (typeof message !== 'string') {
        return null;
    }
    const markerIndex = message.indexOf(MISSING_TOOL_MARKER);
    if (markerIndex === -1) {
        return null;
    }

    const jsonPayload = message.slice(markerIndex + MISSING_TOOL_MARKER.length).trim();
    try {
        const parsed = JSON.parse(jsonPayload) as Partial<MissingToolInfo> | null;
        if (
            parsed &&
            typeof parsed.tool === 'string' &&
            typeof parsed.package === 'string' &&
            typeof parsed.distroName === 'string' &&
            typeof parsed.installCommand === 'string'
        ) {
            return {
                tool: parsed.tool,
                package: parsed.package,
                distroName: parsed.distroName,
                installCommand: parsed.installCommand,
            };
        }
    } catch {
        return null;
    }

    return null;
}

/** Check whether an archive extraction error indicates a password-protected archive. */
export function isPasswordArchiveError(message: string): boolean {
    return typeof message === 'string' && message.includes('ARCHIVE_PASSWORD_REQUIRED');
}

/** Derive the default archive name (without extension) from the selected items and parent folder. */
export function buildDefaultArchiveName(
    items: Array<{ name: string; isDirectory: boolean }>,
    parentDirName: string
): string {
    if (items.length === 1) {
        const [item] = items;
        if (item.isDirectory) {
            return item.name;
        }
        const archiveStem = getArchiveStem(item.name);
        if (archiveStem !== item.name) {
            return archiveStem;
        }
        const lastDot = item.name.lastIndexOf('.');
        if (lastDot > 0) {
            return item.name.slice(0, lastDot);
        }
        return item.name;
    }

    return parentDirName || 'archive';
}

/** Append the selected archive extension unless the user already typed it. */
export function resolveCompressFilename(rawName: string, format: 'zip' | 'tar.gz'): string {
    const trimmed = rawName.trim();
    const suffix = `.${format}`;
    if (trimmed.toLowerCase().endsWith(suffix)) {
        return trimmed;
    }
    return `${trimmed}${suffix}`;
}

/**
 * Resolve a non-colliding destination path for a new archive in `dir`.
 * If `<dir>/<filename>` already exists, increments `<stem> (2).<ext>`, `<stem> (3).<ext>`, etc.,
 * preserving `.tar.gz` as a single extension.
 */
export async function resolveNonCollidingArchivePath(
    dir: string,
    filename: string,
    format: 'zip' | 'tar.gz',
    exists: (p: string) => Promise<boolean>
): Promise<string> {
    const resolvedName = resolveCompressFilename(filename, format);
    const join = (name: string): string => {
        if (!dir) return name;
        if (dir === '/') return `/${name}`;
        return `${dir.replace(/\/+$/, '')}/${name}`;
    };

    const initialPath = join(resolvedName);
    if (!(await exists(initialPath))) {
        return initialPath;
    }

    const suffix = `.${format}`;
    const hasSuffix =
        resolvedName.toLowerCase().endsWith(suffix) && resolvedName.length > suffix.length;
    const stem = hasSuffix ? resolvedName.slice(0, resolvedName.length - suffix.length) : resolvedName;
    const ext = hasSuffix ? resolvedName.slice(resolvedName.length - suffix.length) : suffix;

    for (let counter = 2; counter < 10_000; counter++) {
        const candidate = join(`${stem} (${counter})${ext}`);
        if (!(await exists(candidate))) {
            return candidate;
        }
    }

    return join(`${stem} (${Date.now()})${ext}`);
}
