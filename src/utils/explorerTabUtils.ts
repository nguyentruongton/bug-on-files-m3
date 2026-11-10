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
