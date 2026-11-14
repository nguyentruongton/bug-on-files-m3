import path from 'path';

export interface ExtractCommand {
  cmd: string;
  args: string[];
}

export interface DesktopEntry {
  name: string;
  icon: string | null;
  exec: string;
  noDisplay: boolean;
  mimeTypes: string[];
  path?: string;
}

export function getExtractCommand(filePath: string): ExtractCommand | null {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.zip') {
    return { cmd: 'unzip', args: ['-o', filePath, '-d', dir] };
  }

  if (ext === '.tar' || ext === '.gz' || ext === '.xz' || ext === '.tgz') {
    return { cmd: 'tar', args: ['-xf', filePath, '-C', dir] };
  }

  return null;
}

export function getListEntriesCommand(filePath: string): ExtractCommand | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip') {
    return { cmd: 'unzip', args: ['-Z1', filePath] };
  }
  if (ext === '.tar' || ext === '.gz' || ext === '.xz' || ext === '.tgz') {
    return { cmd: 'tar', args: ['-tf', filePath] };
  }
  return null;
}

export function getVerboseExtractCommand(filePath: string): ExtractCommand | null {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip') {
    return { cmd: 'unzip', args: ['-o', filePath, '-d', dir] };
  }
  if (ext === '.tar' || ext === '.gz' || ext === '.xz' || ext === '.tgz') {
    return { cmd: 'tar', args: ['-xvf', filePath, '-C', dir] };
  }
  return null;
}

export function parseExtractedEntryLine(cmd: string, line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (cmd === 'unzip') {
    const lower = trimmed.toLowerCase();
    for (const prefix of ['inflating:', 'extracting:', 'creating:', 'linking:']) {
      if (lower.startsWith(prefix)) {
        const rest = trimmed.slice(prefix.length).trim();
        return rest || null;
      }
    }
    return null;
  }
  if (cmd === 'tar') {
    return trimmed;
  }
  return null;
}

function getMainDesktopSection(content: string): string {
  const entryIndex = content.indexOf('[Desktop Entry]');
  if (entryIndex === -1) return content;

  const afterHeader = content.slice(entryIndex + '[Desktop Entry]'.length);
  const nextSectionMatch = afterHeader.match(/\n\[[^\]]+\]/);
  if (!nextSectionMatch || nextSectionMatch.index === undefined) {
    return afterHeader;
  }
  return afterHeader.slice(0, nextSectionMatch.index);
}

export function parseDesktopEntry(content: string, filePath?: string): DesktopEntry | null {
  const section = getMainDesktopSection(content);

  const nameMatch = section.match(/^Name=(.*)$/m);
  const execMatch = section.match(/^Exec=(.*)$/m);
  if (!nameMatch || !execMatch) return null;

  const iconMatch = section.match(/^Icon=(.*)$/m);
  const noDisplayMatch = section.match(/^NoDisplay=(.*)$/m);
  const mimeMatch = section.match(/^MimeType=(.*)$/m);

  const exec = execMatch[1]
    .replace(/%[fFuUikc]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!exec) return null;

  const mimeTypes = mimeMatch
    ? mimeMatch[1]
        .split(';')
        .map((m) => m.trim())
        .filter(Boolean)
    : [];

  const entry: DesktopEntry = {
    name: nameMatch[1].trim(),
    icon: iconMatch ? iconMatch[1].trim() || null : null,
    exec,
    noDisplay: noDisplayMatch ? noDisplayMatch[1].trim().toLowerCase() === 'true' : false,
    mimeTypes,
  };

  if (filePath !== undefined) {
    entry.path = filePath;
  }

  return entry;
}

export function matchesMimeType(entryMimeTypes: string[], targetMime: string): boolean {
  const normalizedTarget = targetMime.trim().toLowerCase();
  if (!normalizedTarget) return false;
  return entryMimeTypes.some((mime) => mime.trim().toLowerCase() === normalizedTarget);
}

export type PlaceKey = 'home' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';

export interface PlaceItem {
  name: string;
  path: string;
  icon: string;
}

const PLACE_DEFINITIONS: Array<{ key: PlaceKey; name: string; icon: string }> = [
  { key: 'home', name: 'Home', icon: '🏠' },
  { key: 'desktop', name: 'Desktop', icon: '🖥️' },
  { key: 'documents', name: 'Documents', icon: '📄' },
  { key: 'downloads', name: 'Downloads', icon: '⬇️' },
  { key: 'music', name: 'Music', icon: '🎵' },
  { key: 'pictures', name: 'Pictures', icon: '🖼️' },
  { key: 'videos', name: 'Videos', icon: '🎥' },
];

function stripTrailingSlashes(p: string): string {
  if (!p || p === '/') return p;
  return p.replace(/\/+$/, '');
}

export function resolvePlaces(
  homeDir: string,
  getSystemPath: (key: PlaceKey) => string
): PlaceItem[] {
  const normalizedHome = stripTrailingSlashes(homeDir);

  return PLACE_DEFINITIONS.map(({ key, name, icon }) => {
    if (key === 'home') {
      return { name, path: normalizedHome, icon };
    }

    let resolved = '';
    try {
      resolved = stripTrailingSlashes(getSystemPath(key) || '');
    } catch {
      resolved = '';
    }

    if (!resolved || resolved === normalizedHome) {
      resolved = path.join(normalizedHome, name);
    }

    return { name, path: resolved, icon };
  });
}
