import type { IFile } from '../types/files';

export type ConflictAction = 'replace' | 'skip' | 'keep-both' | 'cancel';

export interface PasteDeps {
  exists(path: string): Promise<boolean>;
  copy(src: string, dest: string): Promise<unknown>;
  move(src: string, dest: string): Promise<unknown>;
  trash(path: string): Promise<unknown>;
  resolveConflict(
    file: IFile,
    destPath: string,
    remaining: number
  ): Promise<{ action: ConflictAction; applyToAll: boolean }>;
}

export interface PasteResult {
  done: number;
  skipped: number;
  failed: string[];
  cancelled: boolean;
}

function normalizePath(p: string): string {
  const clean = p.replace(/\/+/g, '/');
  if (clean.length > 1 && clean.endsWith('/')) {
    return clean.slice(0, -1);
  }
  return clean || '/';
}

function joinPath(dir: string, name: string): string {
  const norm = normalizePath(dir);
  return norm === '/' ? `/${name}` : `${norm}/${name}`;
}

export async function getUniqueName(
  name: string,
  taken: (candidate: string) => Promise<boolean>
): Promise<string> {
  const lastDot = name.lastIndexOf('.');
  let stem: string;
  let ext: string;

  if (lastDot <= 0) {
    stem = name;
    ext = '';
  } else {
    stem = name.slice(0, lastDot);
    ext = name.slice(lastDot);
  }

  let counter = 2;
  while (true) {
    const candidate = `${stem} (${counter})${ext}`;
    const isTaken = await taken(candidate);
    if (!isTaken) {
      return candidate;
    }
    counter++;
  }
}

export function isSameOrDescendant(parent: string, child: string): boolean {
  const p = normalizePath(parent);
  const c = normalizePath(child);
  if (p === c) return true;
  if (p === '/') return c.startsWith('/');
  return c.startsWith(p + '/');
}

export async function runPaste(
  files: IFile[],
  operation: 'copy' | 'cut',
  destDir: string,
  deps: PasteDeps
): Promise<PasteResult> {
  const result: PasteResult = {
    done: 0,
    skipped: 0,
    failed: [],
    cancelled: false,
  };

  let savedAction: ConflictAction | null = null;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    // Check illegal recursive paste into self or descendant
    if (file.isDirectory && isSameOrDescendant(file.path, destDir)) {
      result.failed.push(file.name);
      continue;
    }

    const destPath = joinPath(destDir, file.name);

    // Same folder handling
    if (normalizePath(file.path) === destPath) {
      if (operation === 'cut') {
        // Same-folder cut: no IO, skipped: 1, no trash
        result.skipped++;
        continue;
      } else {
        // Same-folder copy: no prompt, copies to unique name
        try {
          const uniqueName = await getUniqueName(file.name, (candidate) =>
            deps.exists(joinPath(destDir, candidate))
          );
          const uniqueDestPath = joinPath(destDir, uniqueName);
          await deps.copy(file.path, uniqueDestPath);
          result.done++;
        } catch {
          result.failed.push(file.name);
        }
        continue;
      }
    }

    // Check if target already exists
    const exists = await deps.exists(destPath);
    if (!exists) {
      try {
        if (operation === 'copy') {
          await deps.copy(file.path, destPath);
        } else {
          await deps.move(file.path, destPath);
        }
        result.done++;
      } catch {
        result.failed.push(file.name);
      }
      continue;
    }

    // Conflict resolution
    let action: ConflictAction;
    if (savedAction !== null) {
      action = savedAction;
    } else {
      const remaining = files.length - i;
      const resolution = await deps.resolveConflict(file, destPath, remaining);
      action = resolution.action;
      if (resolution.applyToAll) {
        savedAction = action;
      }
    }

    if (action === 'cancel') {
      result.cancelled = true;
      break;
    }

    if (action === 'skip') {
      result.skipped++;
      continue;
    }

    if (action === 'keep-both') {
      try {
        const uniqueName = await getUniqueName(file.name, (candidate) =>
          deps.exists(joinPath(destDir, candidate))
        );
        const uniqueDestPath = joinPath(destDir, uniqueName);
        if (operation === 'copy') {
          await deps.copy(file.path, uniqueDestPath);
        } else {
          await deps.move(file.path, uniqueDestPath);
        }
        result.done++;
      } catch {
        result.failed.push(file.name);
      }
      continue;
    }

    if (action === 'replace') {
      try {
        await deps.trash(destPath);
        if (operation === 'copy') {
          await deps.copy(file.path, destPath);
        } else {
          await deps.move(file.path, destPath);
        }
        result.done++;
      } catch {
        result.failed.push(file.name);
      }
      continue;
    }
  }

  return result;
}
