import { normalizePath } from './navigationHistory';
import { getUniqueName, isSameOrDescendant } from './pasteRunner';

export function pruneSelectedFiles(
  prev: Set<string>,
  currentFiles: Array<{ path: string }>
): Set<string> {
  if (prev.size === 0) return prev;
  const validPaths = new Set(currentFiles.map((f) => f.path));
  let changed = false;
  const next = new Set<string>();
  for (const p of prev) {
    if (validPaths.has(p)) {
      next.add(p);
    } else {
      changed = true;
    }
  }
  return changed ? next : prev;
}

export interface FolderRecoveryDeps {
  exists: (path: string) => Promise<boolean>;
  getParentPath: (path: string) => Promise<string>;
  loadPath: (path: string) => void;
  showToast: (msg: string, type: 'info' | 'error' | 'success') => void;
}

export async function recoverMissingFolder(
  missingPath: string,
  deps: FolderRecoveryDeps
): Promise<void> {
  let checkPath = missingPath;
  while (checkPath) {
    const parent = await deps.getParentPath(checkPath);
    if (!parent || parent === checkPath) {
      if (await deps.exists(parent || '/')) {
        deps.loadPath(parent || '/');
        deps.showToast('Folder no longer exists', 'info');
      }
      break;
    }
    if (await deps.exists(parent)) {
      deps.loadPath(parent);
      deps.showToast('Folder no longer exists', 'info');
      break;
    }
    checkPath = parent;
  }
}

export interface ReloadGuardArgs {
  seq: number;
  expectedSeq: number;
  currentPath: string | null;
  targetPath: string;
  searchActive: boolean;
}

export function shouldApplyReload({
  seq,
  expectedSeq,
  currentPath,
  targetPath,
  searchActive,
}: ReloadGuardArgs): boolean {
  return seq === expectedSeq && currentPath === targetPath && !searchActive;
}

export interface DragCompletionResult {
  shouldReload: boolean;
  nextPendingReload: boolean;
}

export function resolveDragCompletion(
  triggerPendingReload: boolean,
  pendingReload: boolean
): DragCompletionResult {
  return {
    shouldReload: triggerPendingReload && pendingReload,
    nextPendingReload: false,
  };
}

export function shouldSyncQuickLookOnRender<T>(
  quickLookPath: string | null,
  prevSorted: T[],
  currentSorted: T[]
): boolean {
  return quickLookPath !== null && prevSorted !== currentSorted;
}

export function resolveExtractProgressPercent(percent?: number | null): number | undefined {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export interface InboundDropDeps {
  exists: (path: string) => Promise<boolean>;
  copyFile: (source: string, dest: string) => Promise<boolean>;
}

function getParentDirPath(filePath: string): string {
  const norm = normalizePath(filePath);
  const lastSlash = norm.lastIndexOf('/');
  return lastSlash > 0 ? norm.slice(0, lastSlash) : '/';
}

function joinDestPath(dir: string, name: string): string {
  const norm = normalizePath(dir);
  return norm === '/' ? `/${name}` : `${norm}/${name}`;
}

export async function processInboundDrop(
  paths: string[],
  currentPath: string,
  searchActive: boolean,
  deps: InboundDropDeps
): Promise<number> {
  if (
    searchActive ||
    !currentPath ||
    currentPath === 'app://trash' ||
    currentPath === 'app://dashboard'
  ) {
    return 0;
  }

  const normalizedDestDir = normalizePath(currentPath);
  let copiedCount = 0;

  for (const rawPath of paths) {
    if (!rawPath || !rawPath.startsWith('/') || rawPath.includes('\0')) {
      continue;
    }

    const sourcePath = normalizePath(rawPath);
    const parentDir = getParentDirPath(sourcePath);

    // Block same-folder self-drops and recursive ancestor/self drops
    if (parentDir === normalizedDestDir || isSameOrDescendant(sourcePath, normalizedDestDir)) {
      continue;
    }

    const fileName = sourcePath.split('/').pop();
    if (!fileName) continue;

    let destPath = joinDestPath(normalizedDestDir, fileName);
    if (await deps.exists(destPath)) {
      const uniqueName = await getUniqueName(fileName, (candidate) =>
        deps.exists(joinDestPath(normalizedDestDir, candidate))
      );
      destPath = joinDestPath(normalizedDestDir, uniqueName);
    }

    const ok = await deps.copyFile(sourcePath, destPath);
    if (ok !== false) {
      copiedCount++;
    }
  }

  return copiedCount;
}


