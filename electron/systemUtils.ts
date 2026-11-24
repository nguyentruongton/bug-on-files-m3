import path from 'path';

export interface ExtractCommand {
  cmd: string;
  args: string[];
}

export interface MissingToolInfo {
  tool: string;
  package: string;
  distroName: string;
  installCommand: string;
}

export interface DesktopEntry {
  name: string;
  icon: string | null;
  exec: string;
  noDisplay: boolean;
  mimeTypes: string[];
  path?: string;
}

function buildExtractCommand(
  filePath: string,
  destDir: string | undefined,
  verbose: boolean
): ExtractCommand | null {
  const dir = destDir && destDir.trim() ? destDir : path.dirname(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.zip') {
    return { cmd: 'unzip', args: ['-o', filePath, '-d', dir] };
  }

  if (ext === '.tar' || ext === '.gz' || ext === '.xz' || ext === '.tgz') {
    return { cmd: 'tar', args: [verbose ? '-xvf' : '-xf', filePath, '-C', dir] };
  }

  if (ext === '.rar') {
    const rarDir = dir.endsWith('/') ? dir : `${dir}/`;
    return { cmd: 'unrar', args: ['x', '-o+', '-p-', filePath, rarDir] };
  }

  return null;
}

export function getExtractCommand(filePath: string, destDir?: string): ExtractCommand | null {
  return buildExtractCommand(filePath, destDir, false);
}

export function getListEntriesCommand(filePath: string): ExtractCommand | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip') {
    return { cmd: 'unzip', args: ['-Z1', filePath] };
  }
  if (ext === '.tar' || ext === '.gz' || ext === '.xz' || ext === '.tgz') {
    return { cmd: 'tar', args: ['-tf', filePath] };
  }
  if (ext === '.rar') {
    return { cmd: 'unrar', args: ['lb', '-p-', filePath] };
  }
  return null;
}

export function getVerboseExtractCommand(filePath: string, destDir?: string): ExtractCommand | null {
  return buildExtractCommand(filePath, destDir, true);
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
  if (cmd === 'unrar') {
    for (const prefix of ['Extracting ', 'Creating ']) {
      if (trimmed.startsWith(prefix)) {
        const rest = trimmed.slice(prefix.length);
        if (rest.endsWith('OK')) {
          const beforeOk = rest.slice(0, -2);
          if (beforeOk.length > 0 && /\s/.test(beforeOk[beforeOk.length - 1])) {
            const entry = beforeOk.trim();
            return entry || null;
          }
        }
      }
    }
    return null;
  }
  return null;
}

const PASSWORD_ERROR_PATTERNS = [
  'specified password is incorrect',
  'enter password (will not be echoed)',
  'incorrect password',
  'wrong password',
  'password is required',
];

export function isPasswordError(output: string): boolean {
  const lower = output.toLowerCase();
  return PASSWORD_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function getCompressCommand(
  destArchive: string,
  relItems: string[],
  format: 'zip' | 'tar.gz'
): ExtractCommand | null {
  if (relItems.length === 0 || !destArchive.trim()) return null;

  const normalized = (format as string).toLowerCase();
  if (normalized === 'zip') {
    return { cmd: 'zip', args: ['-r', destArchive, '--', ...relItems] };
  }
  if (normalized === 'tar.gz') {
    return { cmd: 'tar', args: ['-czvf', destArchive, '--', ...relItems] };
  }
  return null;
}

export function resolveCommonParentAndRelPaths(
  paths: string[]
): { cwd: string; relItems: string[] } | null {
  if (!paths || paths.length === 0) return null;

  const normalizedPaths = paths.map((p) => {
    const trimmed = p.length > 1 ? p.replace(/\/+$/, '') : p;
    return path.normalize(trimmed);
  });

  if (normalizedPaths.some((p) => !p || p === '/' || !path.basename(p))) {
    return null;
  }

  const parentDirs = normalizedPaths.map((p) => path.dirname(p));
  const isAbsolute = path.isAbsolute(parentDirs[0]);
  const splitSegments = (dir: string) =>
    dir.split(path.sep).filter((seg) => seg.length > 0);

  let commonSegments = splitSegments(parentDirs[0]);
  for (let i = 1; i < parentDirs.length; i++) {
    const segs = splitSegments(parentDirs[i]);
    let k = 0;
    while (k < commonSegments.length && k < segs.length && commonSegments[k] === segs[k]) {
      k++;
    }
    commonSegments = commonSegments.slice(0, k);
  }

  const cwd = isAbsolute
    ? `${path.sep}${commonSegments.join(path.sep)}`
    : commonSegments.length > 0
      ? commonSegments.join(path.sep)
      : '.';

  const relItems = normalizedPaths.map((p) => path.relative(cwd, p));
  if (relItems.some((item) => !item || item.startsWith('..'))) {
    return null;
  }

  return { cwd, relItems };
}

function stripZipRatioSuffix(entry: string): string {
  for (const marker of [' (stored ', ' (deflated ', ' (in=']) {
    const idx = entry.lastIndexOf(marker);
    if (idx !== -1 && entry.endsWith(')')) {
      return entry.slice(0, idx).trimEnd();
    }
  }
  return entry;
}

export function parseCompressedEntryLine(cmd: string, line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (cmd === 'tar') {
    return trimmed;
  }
  if (cmd === 'zip') {
    const lower = trimmed.toLowerCase();
    for (const prefix of ['adding:', 'updating:']) {
      if (lower.startsWith(prefix)) {
        const rest = trimmed.slice(prefix.length).trim();
        const cleaned = stripZipRatioSuffix(rest);
        return cleaned || null;
      }
    }
    return null;
  }
  return null;
}

type DistroFamily = 'arch' | 'debian' | 'fedora' | 'opensuse';

const ARCH_IDS = new Set(['arch', 'manjaro', 'endeavouros', 'cachyos', 'garuda', 'artix']);
const DEBIAN_IDS = new Set(['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary', 'zorin', 'raspbian']);
const FEDORA_IDS = new Set(['fedora', 'rhel', 'centos', 'rocky', 'almalinux']);
const TOOL_PACKAGES: Record<string, string> = {
  unrar: 'unrar',
  unzip: 'unzip',
  zip: 'zip',
  tar: 'tar',
};

function unquoteOsReleaseValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function detectDistroFamily(id: string, idLike: string): DistroFamily | null {
  const tokens = [id.toLowerCase(), ...idLike.toLowerCase().split(/\s+/)].filter(Boolean);
  for (const token of tokens) {
    if (ARCH_IDS.has(token)) return 'arch';
    if (DEBIAN_IDS.has(token)) return 'debian';
    if (FEDORA_IDS.has(token)) return 'fedora';
    if (token.startsWith('opensuse') || token === 'suse' || token === 'sles') return 'opensuse';
  }
  return null;
}

export function parseOsReleaseAndCommand(osReleaseContent: string, tool: string): MissingToolInfo {
  let id = '';
  let idLike = '';
  let prettyName = '';
  let name = '';

  for (const line of osReleaseContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = unquoteOsReleaseValue(trimmed.slice(eqIdx + 1));
    if (key === 'ID') id = value;
    else if (key === 'ID_LIKE') idLike = value;
    else if (key === 'PRETTY_NAME') prettyName = value;
    else if (key === 'NAME') name = value;
  }

  const distroName = prettyName || name || 'Linux';
  const pkg = TOOL_PACKAGES[tool] ?? tool;
  const family = detectDistroFamily(id, idLike);

  let installCommand: string;
  switch (family) {
    case 'arch':
      installCommand = `sudo pacman -S ${pkg}`;
      break;
    case 'debian':
      installCommand = `sudo apt update && sudo apt install ${pkg}`;
      break;
    case 'fedora':
      installCommand = `sudo dnf install ${pkg}`;
      break;
    case 'opensuse':
      installCommand = `sudo zypper install ${pkg}`;
      break;
    default:
      installCommand = `Install "${pkg}" using your distribution's package manager`;
  }

  return { tool, package: pkg, distroName, installCommand };
}

export function formatMissingToolError(osReleaseContent: string, tool: string): string {
  return `MISSING_TOOL:${JSON.stringify(parseOsReleaseAndCommand(osReleaseContent, tool))}`;
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
