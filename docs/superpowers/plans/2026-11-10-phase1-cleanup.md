# Phase 1: Technical Debt Cleanup & Core Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate technical debt, shell injection vulnerabilities, legacy DBus/Konsole code, hardcoded paths, and unoptimized file list rendering while completing baseline explorer interactions (Back/Forward history, New Folder creation, multi-file Context Menu) before the Phase 2 UI/UX overhaul.

**Architecture:** Extract testable pure helpers for Electron system/shell operations (`electron/systemUtils.ts`), Dashboard pin migration (`src/utils/dashboardUtils.ts`), and per-tab navigation history (`src/utils/navigationHistory.ts`), verified via `bun test`. Wire these helpers into the Electron IPC layer (`electron/main.ts`, `electron/preload.ts`) and React components (`App.tsx`, `ExplorerTab.tsx`, `Dashboard.tsx`, `FileList.tsx`, `TerminalPane.tsx`).

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, Vite 7, Bun test runner (`bun test`).

**Spec:** `docs/superpowers/specs/2026-11-10-phase1-cleanup-design.md`

## Global Constraints

- Must maintain compatibility with existing Electron 39 + React 19 + TypeScript + Vite build pipelines (`npm run build`, `npm run lint`).
- Remove unused runtime dependencies from `package.json`: `dbus-next`, `react-window`, and `react-virtualized-auto-sizer`.
- Linux system commands (`lsblk`, `df`, `du`, `unzip`, `tar`, `xdg-mime`, `find`) must be invoked via `execFileAsync(command, argsArray)` — zero string-interpolated `execAsync` calls in `electron/main.ts`.
- Do not introduce JS virtualization wrappers (`react-window`); use native `<img loading="lazy" decoding="async" />` and CSS `content-visibility: auto`.

## Review Focus

1. **Filenames with shell metacharacters (`$(touch pwned)`, quotes, spaces) passed to extraction or MIME lookup**: Must be passed as discrete array elements to `execFileAsync` and never interpreted by a shell.
2. **Compound archive extensions (`.tar.gz`, `.tar.xz`, `.tgz`)**: Extraction command builder must route `.gz`, `.xz`, `.tgz`, and `.tar` to `tar -xf <filePath> -C <dir>` rather than failing or mis-detecting.
3. **Existing `localStorage` containing legacy `/home/bhimio` pinned paths**: Must automatically migrate to the current user's `Home`, `Downloads`, and `Documents` places without wiping custom valid pins added by the user.
4. **Terminal `cd` triggered when active tab is `app://dashboard` or when right-clicking a regular file for `"Open in Terminal"`**: Must ignore `app://` pseudo-paths and resolve a clicked file's target terminal directory to its parent directory.
5. **Back/Forward navigation at history boundaries or when navigating to the identical current path**: Must not push duplicate consecutive entries or go out of bounds (`historyIndex < 0` or `>= history.length`).

---

### Task 1: Dependency Cleanup & Electron Shell/Desktop Helpers

**Files:**
- Modify: `package.json`
- Create: `electron/systemUtils.ts`
- Create: `electron/__tests__/systemUtils.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`

**Interfaces:**
- Consumes: Node `fs`, `path`, `child_process.execFile`
- Produces:
  - `electron/systemUtils.ts`:
    - `getExtractCommand(filePath: string): { cmd: string; args: string[] } | null`
    - `parseDesktopEntry(content: string, filePath?: string): { name: string; icon: string | null; exec: string; noDisplay: boolean; mimeTypes: string[]; path?: string } | null`
    - `matchesMimeType(entryMimeTypes: string[], targetMime: string): boolean`
  - `window.electron.openDirectoryDialog: () => Promise<string | null>` (added to `preload.ts` and `src/types/electron.d.ts`)
  - Removes `window.electron.terminalOpen` and `window.electron.cdTerminal` from `preload.ts` and `src/types/electron.d.ts`

- [ ] **Step 1: Write the failing unit tests in `electron/__tests__/systemUtils.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { getExtractCommand, parseDesktopEntry, matchesMimeType } from '../systemUtils';

describe('getExtractCommand', () => {
  test('builds safe unzip args for .zip with shell metacharacters in path', () => {
    const file = '/tmp/my "archive" $(whoami).zip';
    expect(getExtractCommand(file)).toEqual({
      cmd: 'unzip',
      args: ['-o', file, '-d', '/tmp'],
    });
  });

  test('builds safe tar args for .tar, .gz, .xz, .tgz', () => {
    for (const ext of ['.tar', '.tar.gz', '.gz', '.tar.xz', '.xz', '.tgz']) {
      const file = `/home/user/archive${ext}`;
      expect(getExtractCommand(file)).toEqual({
        cmd: 'tar',
        args: ['-xf', file, '-C', '/home/user'],
      });
    }
  });

  test('returns null for unsupported extensions', () => {
    expect(getExtractCommand('/home/user/notes.txt')).toBeNull();
  });
});

describe('parseDesktopEntry & matchesMimeType', () => {
  const sampleDesktop = `
[Desktop Entry]
Name=Visual Studio Code
Exec=/usr/share/code/code --unity-launch %F
Icon=vscode
Type=Application
NoDisplay=false
MimeType=text/plain;inode/directory;application/x-code-workspace;
`;

  test('parses Name, Icon, cleaned Exec, NoDisplay, and MimeType list', () => {
    const parsed = parseDesktopEntry(sampleDesktop, '/usr/share/applications/code.desktop');
    expect(parsed).toEqual({
      name: 'Visual Studio Code',
      icon: 'vscode',
      exec: '/usr/share/code/code --unity-launch',
      noDisplay: false,
      mimeTypes: ['text/plain', 'inode/directory', 'application/x-code-workspace'],
      path: '/usr/share/applications/code.desktop',
    });
  });

  test('marks NoDisplay=true entries accurately', () => {
    const hidden = `[Desktop Entry]\nName=HiddenHelper\nExec=helper %u\nNoDisplay=true\n`;
    expect(parseDesktopEntry(hidden)?.noDisplay).toBe(true);
  });

  test('matches exact MIME type from parsed list', () => {
    expect(matchesMimeType(['text/plain', 'image/png'], 'image/png')).toBe(true);
    expect(matchesMimeType(['text/plain', 'image/png'], 'image/jpeg')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test electron/__tests__/systemUtils.test.ts`
Expected: FAIL with `Cannot find module '../systemUtils'`

- [ ] **Step 3: Implement `electron/systemUtils.ts`**

Implement `getExtractCommand`, `parseDesktopEntry`, and `matchesMimeType` matching the exact signatures and expectations above. Strip field codes (`%[fFuUikc]`) and collapse trailing whitespace on `exec`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test electron/__tests__/systemUtils.test.ts`
Expected: PASS (5 tests passing)

- [ ] **Step 5: Clean `package.json`, `electron/main.ts`, `electron/preload.ts`, and `src/types/electron.d.ts`**

- In `package.json`: remove `"dbus-next"`, `"react-virtualized-auto-sizer"`, and `"react-window"` from `"dependencies"`.
- In `electron/main.ts`:
  - Remove `import dbus from 'dbus-next'`, `exec` import, `execAsync`, `terminalProcess`, `terminalSessionProxy`, `setupTerminal`, `ipcMain.handle('terminal:open', ...)`, and `ipcMain.handle('terminal:cd', ...)`.
  - In `app.on('window-all-closed')`, replace the `terminalProcess` kill block with `killAllPty();`.
  - Add `ipcMain.handle('dialog:open-directory', async () => ...)` using `dialog.showOpenDialog({ properties: ['openDirectory'] })` returning `filePaths[0]` or `null` if canceled.
  - Refactor `fs:extract` to use `getExtractCommand(filePath)` and `execFileAsync(cmd, args)`.
  - Refactor `system:get-drives` to `execFileAsync('lsblk', ['--json', '-o', 'NAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM'])`.
  - Refactor `system:get-storage-usage` to `execFileAsync('df', ['-kP', '/'])`.
  - Refactor `system:get-directory-size` to `execFileAsync('du', ['-sb', dirPath])`.
  - Refactor `system:get-apps` and `system:get-recommended-apps` to use `execFileAsync('xdg-mime', ['query', 'filetype', filePath])`, `fs.readdir`, `fs.readFile`, `parseDesktopEntry`, and `matchesMimeType` (zero `grep` shell calls).
- In `electron/preload.ts` and `src/types/electron.d.ts`:
  - Remove `terminalOpen` and `cdTerminal`.
  - Add `openDirectoryDialog: () => ipcRenderer.invoke('dialog:open-directory')` (and `openDirectoryDialog: () => Promise<string | null>` in `IElectronAPI`).

- [ ] **Step 6: Verify TypeScript compilation for Electron**

Run: `npx tsc -p electron/tsconfig.json --noEmit`
Expected: Exits with code 0 and no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json electron/ src/types/electron.d.ts
git commit -m "refactor(electron): replace shell exec with execFileAsync and remove legacy dbus code"
```

---

### Task 2: FileList Rendering Performance (`content-visibility` & Lazy Thumbnails)

**Files:**
- Modify: `src/components/FileList.tsx:85-105`
- Modify: `src/components/FileList.css:15-66`

**Interfaces:**
- Consumes: `IFile` from `src/types/files.ts`
- Produces: Updated `FileList` component with lazy async image decoding and CSS `content-visibility: auto`.

- [ ] **Step 1: Update `src/components/FileList.tsx` image attributes**

Add `loading="lazy"` and `decoding="async"` to the `<img src={`media://${file.path}`} ... />` element inside `src/components/FileList.tsx`.

- [ ] **Step 2: Update `src/components/FileList.css` with `content-visibility`**

- On `.file-list-item`: add `content-visibility: auto;` and `contain-intrinsic-size: auto 52px;`.
- On `.file-list.grid .file-list-item`: add `contain-intrinsic-size: auto 120px;`.

- [ ] **Step 3: Verify frontend TypeScript check**

Run: `npx tsc -b --noEmit`
Expected: Note any remaining `TerminalService` reference in `App.tsx` (to be removed in Task 4) or 0 errors inside `FileList.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/FileList.tsx src/components/FileList.css
git commit -m "perf(file-list): add lazy image decoding and CSS content-visibility"
```

---

### Task 3: Dashboard Dynamic Default Pins & Legacy Path Migration

**Files:**
- Create: `src/utils/dashboardUtils.ts`
- Create: `src/utils/__tests__/dashboardUtils.test.ts`
- Modify: `src/components/Dashboard.tsx`

**Interfaces:**
- Consumes: `window.electron.getPlaces()`, `window.electron.openDirectoryDialog()`
- Produces:
  - `src/utils/dashboardUtils.ts`:
    - `export interface PinnedItem { name: string; path: string; icon?: string }`
    - `export function resolveInitialPins(savedPins: PinnedItem[], places: Array<{ name: string; path: string }>): PinnedItem[]`

- [ ] **Step 1: Write the failing test in `src/utils/__tests__/dashboardUtils.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { resolveInitialPins, type PinnedItem } from '../dashboardUtils';

const mockPlaces = [
  { name: 'Home', path: '/home/stark' },
  { name: 'Desktop', path: '/home/stark/Desktop' },
  { name: 'Documents', path: '/home/stark/Documents' },
  { name: 'Downloads', path: '/home/stark/Downloads' },
];

describe('resolveInitialPins', () => {
  test('builds default Home, Downloads, Documents pins when savedPins is empty', () => {
    expect(resolveInitialPins([], mockPlaces)).toEqual([
      { name: 'Home', path: '/home/stark' },
      { name: 'Downloads', path: '/home/stark/Downloads' },
      { name: 'Documents', path: '/home/stark/Documents' },
    ]);
  });

  test('migrates legacy /home/bhimio pins while preserving custom user pins', () => {
    const legacyPins: PinnedItem[] = [
      { name: 'Home', path: '/home/bhimio' },
      { name: 'Downloads', path: '/home/bhimio/Downloads' },
      { name: 'Documents', path: '/home/bhimio/Documents' },
      { name: 'Projects', path: '/home/stark/Projects' },
    ];
    expect(resolveInitialPins(legacyPins, mockPlaces)).toEqual([
      { name: 'Home', path: '/home/stark' },
      { name: 'Downloads', path: '/home/stark/Downloads' },
      { name: 'Documents', path: '/home/stark/Documents' },
      { name: 'Projects', path: '/home/stark/Projects' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/__tests__/dashboardUtils.test.ts`
Expected: FAIL with `Cannot find module '../dashboardUtils'`

- [ ] **Step 3: Implement `src/utils/dashboardUtils.ts`**

Implement `resolveInitialPins(savedPins, places)`:
- Extract `Home`, `Downloads`, and `Documents` from `places`.
- Filter out any entry in `savedPins` whose `path === '/home/bhimio'` or `path.startsWith('/home/bhimio/')`.
- If `savedPins` was empty or had legacy `/home/bhimio` entries removed, prepend the default `Home`, `Downloads`, `Documents` places (deduplicated by `path`) before any remaining valid user pins.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/__tests__/dashboardUtils.test.ts`
Expected: PASS

- [ ] **Step 5: Update `src/components/Dashboard.tsx`**

- Initialize `useLocalStorage<PinnedItem[]>('dashboard.pinned', [])` with an empty array `[]` instead of hardcoded `/home/bhimio` paths.
- In `useEffect`, call `window.electron.getPlaces()` and update `setPinnedItems(prev => resolveInitialPins(prev, places))` when `resolveInitialPins` differs from `prev`.
- In `handleAddPin`, call `await window.electron.openDirectoryDialog()` instead of `window.electron.openFileDialog()`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/dashboardUtils.ts src/utils/__tests__/dashboardUtils.test.ts src/components/Dashboard.tsx
git commit -m "fix(dashboard): replace hardcoded /home/bhimio pins and use directory dialog"
```

---

### Task 4: Per-Tab Navigation History & Terminal Path Helpers

**Files:**
- Create: `src/utils/navigationHistory.ts`
- Create: `src/utils/__tests__/navigationHistory.test.ts`
- Delete: `src/services/TerminalService.ts`
- Modify: `src/components/TerminalPane.tsx`

**Interfaces:**
- Consumes: none
- Produces:
  - `src/utils/navigationHistory.ts`:
    - `export interface HistoryState { entries: string[]; index: number }`
    - `export function createHistory(initialPath: string): HistoryState`
    - `export function pushHistory(state: HistoryState, nextPath: string): HistoryState`
    - `export function stepBack(state: HistoryState): { state: HistoryState; path: string | null }`
    - `export function stepForward(state: HistoryState): { state: HistoryState; path: string | null }`
    - `export function resolveTerminalTargetDir(targetPath: string, isDirectory: boolean): string | null`

- [ ] **Step 1: Write the failing tests in `src/utils/__tests__/navigationHistory.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import {
  createHistory,
  pushHistory,
  stepBack,
  stepForward,
  resolveTerminalTargetDir,
} from '../navigationHistory';

describe('navigationHistory', () => {
  test('pushes new paths and ignores consecutive duplicate paths', () => {
    let h = createHistory('/home/stark');
    h = pushHistory(h, '/home/stark');
    expect(h).toEqual({ entries: ['/home/stark'], index: 0 });

    h = pushHistory(h, '/home/stark/Documents');
    expect(h).toEqual({ entries: ['/home/stark', '/home/stark/Documents'], index: 1 });
  });

  test('steps back and forward within bounds and truncates forward branch on new push', () => {
    let h = createHistory('/a');
    h = pushHistory(h, '/b');
    h = pushHistory(h, '/c');

    const back1 = stepBack(h);
    expect(back1.path).toBe('/b');
    h = back1.state;

    const back2 = stepBack(h);
    expect(back2.path).toBe('/a');
    h = back2.state;

    expect(stepBack(h).path).toBeNull();

    const fwd1 = stepForward(h);
    expect(fwd1.path).toBe('/b');
    h = fwd1.state;

    h = pushHistory(h, '/d');
    expect(h).toEqual({ entries: ['/a', '/b', '/d'], index: 2 });
    expect(stepForward(h).path).toBeNull();
  });
});

describe('resolveTerminalTargetDir', () => {
  test('returns null for app:// pseudo-paths', () => {
    expect(resolveTerminalTargetDir('app://dashboard', true)).toBeNull();
  });

  test('returns directory path directly when target is a directory', () => {
    expect(resolveTerminalTargetDir('/home/stark/Downloads', true)).toBe('/home/stark/Downloads');
  });

  test('returns parent directory when target is a file', () => {
    expect(resolveTerminalTargetDir('/home/stark/Downloads/report.pdf', false)).toBe('/home/stark/Downloads');
    expect(resolveTerminalTargetDir('/file-at-root.txt', false)).toBe('/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/__tests__/navigationHistory.test.ts`
Expected: FAIL with `Cannot find module '../navigationHistory'`

- [ ] **Step 3: Implement `src/utils/navigationHistory.ts`**

Implement `createHistory`, `pushHistory`, `stepBack`, `stepForward`, and `resolveTerminalTargetDir`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/__tests__/navigationHistory.test.ts`
Expected: PASS

- [ ] **Step 5: Delete `src/services/TerminalService.ts` and update `src/components/TerminalPane.tsx`**

- Delete `src/services/TerminalService.ts`.
- In `src/components/TerminalPane.tsx`:
  - When spawning the PTY on mount (`window.electron.ptySpawn(initialCwd)`), pass `cwd && !cwd.startsWith('app://') ? cwd : ''`.
  - In the `useEffect([cwd])` hook, guard with `if (cwd && !cwd.startsWith('app://') && pidRef.current)` before writing `cd '${safePath}'\r` to the PTY.

- [ ] **Step 6: Commit**

```bash
git rm src/services/TerminalService.ts
git add src/utils/navigationHistory.ts src/utils/__tests__/navigationHistory.test.ts src/components/TerminalPane.tsx
git commit -m "feat(navigation): add tab history helpers and guard terminal cwd against app:// urls"
```

---

### Task 5: ExplorerTab & App Integration (History UI, New Folder, Multi-File Context Menu, JSX Fix)

**Files:**
- Modify: `src/components/ExplorerTab.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes:
  - `createHistory`, `pushHistory`, `stepBack`, `stepForward`, `resolveTerminalTargetDir` from `src/utils/navigationHistory.ts`
  - `FileSystemService.mkdir` from `src/services/FileSystemService.ts`
- Produces:
  - Updated `ExplorerTabProps`:
    - `onContextMenu: (e: React.MouseEvent, file: IFile | null, selectedFiles: IFile[]) => void`
    - `onCreateFolderRequest?: () => void`
  - Clean `ExplorerTab` without stray `// ...` JSX text, with Back/Forward toolbar buttons and `Alt+Left` / `Alt+Right` / `Alt+Up` / `Ctrl+Shift+N` shortcuts.
  - Updated `App.tsx` with:
    - Single-pass `handleCloseTab` state update
    - Working `"Open in Terminal"` context menu item using `resolveTerminalTargetDir` and `terminalCwd` state
    - `"New Folder"` dialog & background context menu item
    - Multi-file Context Menu support for Copy, Cut, and Delete

- [ ] **Step 1: Update `src/components/ExplorerTab.tsx`**

- Remove line 375 (`// ...`) from the JSX tree.
- Add `historyState` (`useState<HistoryState>(() => createHistory(initialPath))`) inside `ExplorerTab`:
  - Update `loadPath(path: string, recordHistory = true)` so normal navigation calls `setHistoryState(prev => pushHistory(prev, path))`, while Back/Forward/Refresh pass `recordHistory = false`.
  - Sync external `initialPath` changes (e.g. Sidebar click) via `loadPath(initialPath, true)` when `initialPath !== currentPath`.
  - Add `handleBack` and `handleForward` handlers using `stepBack` and `stepForward`, calling `loadPath(target, false)`.
  - Render **Back** (`arrow_back`, disabled when `historyState.index <= 0`) and **Forward** (`arrow_forward`, disabled when `historyState.index >= historyState.entries.length - 1`) `IconButton`s immediately before the **Up** (`arrow_upward`) button.
- Add keyboard shortcuts in `ExplorerTab`'s `keydown` listener:
  - `Alt+ArrowLeft`: `handleBack()`
  - `Alt+ArrowRight`: `handleForward()`
  - `Alt+ArrowUp`: `handleUp()`
  - `Ctrl+Shift+N` (or `Meta+Shift+N`): if `currentPath !== 'app://dashboard'`, call `onCreateFolderRequest?.()`.
- Update `onContextMenu` invocation:
  - On background right-click (on the `.content-area` / scroll container in `ExplorerTab`), call `onContextMenu(e, null, [])`.
  - On file item right-click, compute the effective selection (`IFile[]`): if `selectedFiles.has(file.path)`, pass `sortedFiles.filter(f => selectedFiles.has(f.path))`; otherwise select `file` and pass `[file]`.

- [ ] **Step 2: Update `src/App.tsx`**

- Remove `import { TerminalService } from './services/TerminalService';` and the `useEffect` that called `TerminalService.cd`.
- Add `terminalCwd` state (`string | undefined`) initialized to `undefined`, updated whenever `currentPath` changes to a non-`app://` path, or when `"Open in Terminal"` is clicked (`const targetDir = resolveTerminalTargetDir(targetPath, isDir); if (targetDir) { setTerminalCwd(targetDir); setTerminalOpen(true); }`). Pass `cwd={terminalCwd || (currentPath && !currentPath.startsWith('app://') ? currentPath : undefined)}` to `<TerminalPane />`.
- Clean up `handleCloseTab` so it calls `setTabs` only once instead of twice.
- Update `contextMenu` state to `{ x: number; y: number; item: IFile | null; selectedItems: IFile[] } | null`.
- Update Context Menu items:
  - When `contextMenu.item` is present, let `targetItems = contextMenu.selectedItems.length > 0 ? contextMenu.selectedItems : [contextMenu.item]`.
  - **Copy**: copies `targetItems` (`copy(targetItems)`). Label shows `Copy (${targetItems.length})` when `targetItems.length > 1`, else `Copy`.
  - **Cut**: cuts `targetItems` (`cut(targetItems)`). Label shows `Cut (${targetItems.length})` when `targetItems.length > 1`, else `Cut`.
  - **Delete**: trashes all `targetItems` sequentially via `FileSystemService.trash` and refreshes the active tab. Label shows `Delete (${targetItems.length})` when `targetItems.length > 1`, else `Delete`.
  - **Open in Terminal**: resolves `resolveTerminalTargetDir(contextMenu.item.path, contextMenu.item.isDirectory)`, sets `terminalCwd`, opens `TerminalPane`, and closes the context menu.
  - Background Context Menu (`!contextMenu.item`): include **New Folder** (`icon: 'create_new_folder'`, opens the New Folder dialog when `currentPath && !currentPath.startsWith('app://')`) and **Paste** (when clipboard has files).
- Add New Folder Dialog (`newFolderDialogOpen`, `newFolderName` states) in `App.tsx`:
  - Calls `await FileSystemService.mkdir(`${currentPath}/${newFolderName.trim()}`)` and refreshes the active tab.

- [ ] **Step 3: Run full test suite, linter, and production build**

Run: `bun test && npm run lint && npm run build`
Expected: All unit tests pass, ESLint exits 0 (or zero errors in modified files), and `tsc -b && vite build && tsc -p electron/tsconfig.json` succeeds with exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/ExplorerTab.tsx src/App.tsx
git commit -m "feat(explorer): wire tab history, new folder dialog, multi-file context menu, and terminal sync"
```
