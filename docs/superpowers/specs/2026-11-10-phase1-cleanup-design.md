# Phase 1: Technical Debt Cleanup & Core Stabilization Design

## 1. Intent & Why
Prepare the `material-3-file-explorer` codebase as a clean, bug-free, and secure foundation before undertaking a full UI/UX redesign (Phase 2) and adding major new features (Phase 3). Currently, the repository contains leftover legacy code (KDE Konsole DBus), hardcoded author paths (`/home/bhimio`), command injection vulnerabilities in shell calls, unoptimized DOM rendering for large folders/images, and incomplete wiring for basic file operations (terminal navigation, folder creation, multi-file context menu, and tab history).

## 2. Goals, Non-Goals, and Anti-Goals
- **Goals**:
  1. Optimize `FileList` rendering performance for large directories and image thumbnails without overcomplicating layout logic prior to Phase 2.
  2. Fix hardcoded author paths in `Dashboard`, broken folder-pinning dialogs, and stray JSX text (`// ...`) in `ExplorerTab`.
  3. Remove dead KDE Konsole DBus code and fix embedded terminal path synchronization and context menu `"Open in Terminal"`.
  4. Eliminate shell command injection and special-character failures in `electron/main.ts` by replacing string-interpolated `execAsync` calls with `execFileAsync`.
  5. Complete missing baseline interactions: per-tab Back/Forward history, `"New Folder"` UI wiring (`fs:mkdir`), and multi-file Context Menu operations.
- **Non-Goals**:
  - Redesigning the visual aesthetic, color tokens, or component layouts (reserved for Phase 2).
  - Adding major new features like Dual Pane, Quick Look Preview, or `fs.watch` real-time file watchers (reserved for Phase 3).
- **Anti-Goals**:
  - Introducing heavy JS virtualization wrappers (`react-window`) that lock `FileList` into rigid row-height calculations right before the Phase 2 UI/UX overhaul.

## 3. Constraints
- Must maintain compatibility with existing Electron 39 + React 19 + TypeScript + Vite build pipelines (`npm run build`, `npm run lint`).
- Linux system commands (`lsblk`, `df`, `du`, `unzip`, `tar`, `xdg-mime`, `grep`, `find`) remain the underlying OS integration mechanism on Linux, invoked safely via `execFileAsync`.

## 4. Approaches Considered

### Approach A: Minimal Cleanup + CSS `content-visibility` & Native Lazy Loading (Selected)
- Use native `<img loading="lazy" decoding="async" />` and CSS `content-visibility: auto` on `.file-list-item` to prevent offscreen layout/paint bottlenecks and image decoding spikes while keeping the flexible CSS Grid + Semantic Group Header layout intact.
- Remove unused dependencies (`dbus-next`, `react-window`, `react-virtualized-auto-sizer`) from `package.json`.
- Fix all bugs, shell safety issues, terminal IPC sync, and baseline explorer actions directly.
- **Trade-off**: Does not strictly cap the number of DOM nodes like JS windowing if a directory has 50,000+ files, but avoids complex 2D grid/group-header height math that would be discarded in Phase 2.

### Approach B: Full `react-window` Virtualization in Phase 1
- Rewrite `FileList.tsx` around `react-window` (`VariableSizeList` / `FixedSizeGrid`) alongside the bug fixes.
- **Trade-off**: High engineering effort to reconcile dynamic responsive column counts and semantic group headers (`Folders`, `Media`, etc.) with `react-window`, only to rewrite the component in Phase 2. Rejected in favor of Approach A.

## 5. Detailed Design

### 5.1. Rendering Performance & Dependency Cleanup (Builder's Call on Intrinsic Sizes)
- **`package.json`**: Remove unused runtime dependencies: `dbus-next`, `react-window`, and `react-virtualized-auto-sizer`.
- **`src/components/FileList.tsx`**:
  - Add `loading="lazy"` and `decoding="async"` to `<img className="file-thumbnail" ... />`.
- **`src/components/FileList.css`**:
  - Add `content-visibility: auto;` and `contain-intrinsic-size: auto 52px;` to `.file-list-item` (and `contain-intrinsic-size: auto 120px;` for `.file-list.grid .file-list-item`) so Chromium skips rendering offscreen items.

### 5.2. Dashboard, Dialogs & JSX Fixes
- **`src/components/ExplorerTab.tsx`**:
  - Remove the stray `// ...` text line (line 375) inside the JSX tree.
- **`electron/main.ts` & `electron/preload.ts` & `src/types/electron.d.ts`**:
  - Keep `dialog:open-file` (`openFileDialog`) for CSS file selection.
  - Add `dialog:open-directory` (`openDirectoryDialog(): Promise<string | null>`) using `dialog.showOpenDialog({ properties: ['openDirectory'] })`.
- **`src/components/Dashboard.tsx`**:
  - Replace hardcoded `/home/bhimio` default pinned items. Initialize default pins dynamically using `window.electron.getPlaces()` (filtering for `Home`, `Downloads`, `Documents`) when `localStorage` has no saved pins or still contains legacy `/home/bhimio` entries (Builder's Call: auto-migrate `/home/bhimio` entries so existing local dev state is fixed automatically).
  - Update `handleAddPin` to call `window.electron.openDirectoryDialog()` instead of `openFileDialog()`.

### 5.3. Terminal Synchronization & Legacy DBus Removal
- **`electron/main.ts` & `electron/preload.ts` & `src/types/electron.d.ts`**:
  - Remove `import dbus from 'dbus-next'`, `terminalProcess`, `terminalSessionProxy`, `setupTerminal()`, `terminal:open`, and `terminal:cd` handlers.
  - Call `killAllPty()` inside `app.on('window-all-closed')` to ensure spawned PTY processes are cleaned up on exit.
- **`src/services/TerminalService.ts`**:
  - Delete `src/services/TerminalService.ts` (legacy wrapper around no-op IPCs).
- **`src/App.tsx` & `src/components/TerminalPane.tsx`**:
  - Guard terminal directory syncing: only send `cd` to the PTY when the path is a real filesystem path (i.e., `cwd && !cwd.startsWith('app://')`).
  - When the user triggers *"Open in Terminal"* from the context menu:
    - If the target item is a directory, set terminal target path to `item.path`; if it is a file, set it to its parent directory.
    - Open the terminal pane (`setTerminalOpen(true)`) and pass the target directory to `TerminalPane` so it `cd`s into that directory immediately (or spawns in that directory if not yet spawned).

### 5.4. Shell Execution Security (`execFileAsync`)
- **`electron/main.ts`**:
  - Remove string-interpolated `execAsync` calls and use `execFileAsync(command, argsArray)` across all handlers:
    - `fs:extract`:
      - `.zip`: `execFileAsync('unzip', ['-o', filePath, '-d', dir])`
      - `.tar`, `.gz`, `.xz`, `.tgz`: `execFileAsync('tar', ['-xf', filePath, '-C', dir])`
    - `system:get-drives`: `execFileAsync('lsblk', ['--json', '-o', 'NAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM'])`
    - `system:get-storage-usage`: `execFileAsync('df', ['-kP', '/'])`
    - `system:get-directory-size`: `execFileAsync('du', ['-sb', dirPath])`
    - `system:get-recommended-apps`:
      - Use `execFileAsync('xdg-mime', ['query', 'filetype', filePath])`.
      - Instead of running `grep -l "${mime}" "${searchPath}"/*.desktop` via shell globbing, read the directory entries in Node (`fs.readdir(searchPath)`) and inspect `.desktop` files directly in JS (matching `MimeType=` lines containing `mime`), which is both faster and completely immune to shell injection.

### 5.5. Baseline File Explorer Completeness
- **Per-Tab Back / Forward Navigation (`src/components/ExplorerTab.tsx`)**:
  - Maintain `history: string[]` (initialized with `[initialPath]`) and `historyIndex: number` (`0`) inside `ExplorerTab`.
  - Navigating to a new path pushes to `history.slice(0, historyIndex + 1)` and increments `historyIndex`.
  - Add **Back** (`arrow_back`) and **Forward** (`arrow_forward`) `IconButton`s next to the **Up** (`arrow_upward`) button in the top bar, plus support `Alt+Left` (Back), `Alt+Right` (Forward), and `Alt+Up` (Up) keyboard shortcuts.
- **New Folder Creation (`src/App.tsx`, `src/components/ExplorerTab.tsx`)**:
  - Add a `"New Folder"` dialog (similar to the existing Rename dialog) or mode in `App.tsx` / `ExplorerTab.tsx`.
  - Expose `"New Folder"` (`create_new_folder` icon) in the background Context Menu (when right-clicking empty space in a real directory) and bind `Ctrl+Shift+N`.
  - Call `FileSystemService.mkdir(`${currentPath}/${folderName}`)` and refresh the active tab.
- **Multi-File Context Menu & Selection Sync (`src/App.tsx`, `src/components/ExplorerTab.tsx`)**:
  - Pass the active tab's selected files (`IFile[]`) when opening the context menu: `onContextMenu(e, file, selectedFileItems)`.
  - If the right-clicked `file` is part of a multi-selection (`selectedItems.length > 1`), Context Menu actions **Copy**, **Cut**, and **Delete** operate on all `selectedItems` (with label count or batch execution). Single-item actions (**Rename**, **Open**, **Open With...**, **Properties**, **Extract Here**) either apply to the clicked item or are hidden/disabled when multiple items are selected (Builder's Call: keep single-item actions targeting the clicked `contextMenu.item`, while Copy/Cut/Delete apply to the full selection).

## 6. What's Left to the Builder
- Exact CSS spacing/alignment of the Back/Forward buttons in `ExplorerTab`'s toolbar.
- Handling duplicate state updates in `handleCloseTab` in `src/App.tsx` (currently calls `setTabs` twice in a row; clean up into a single state update).
