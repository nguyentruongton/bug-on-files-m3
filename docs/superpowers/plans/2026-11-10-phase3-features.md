# Phase 3 Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paste-conflict resolution, live directory refresh, and a `Space` Quick Look preview to the Material 3 file explorer.

**Architecture:** Pure, dependency-injected logic (paste runner, preview-kind helpers, text preview reader, directory watcher) is unit-tested with `bun test`; thin React/IPC layers wire it into `App.tsx` and `ExplorerTab.tsx`. Order is paste → watch → Quick Look; each part ships independently.

**Tech Stack:** Electron 39, React 19, TypeScript, Vite, `bun:test`, Node `fs.watch` (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-11-10-phase3-features-design.md`

## Global Constraints

- No new npm dependencies (spec: `fs.watch`, no `chokidar`; no syntax-highlight lib).
- Dual-pane is out of scope; watcher is non-recursive, debounce ~150ms.
- Paste dialog choices are exactly **Replace / Skip / Keep both**, plus "Apply to all remaining" when more than one item is pasted; Cancel aborts the rest.
- Keep both names: `name (2).ext`, `(3)`… first free name.
- Replace never merges directories: move existing target to trash first, then copy/move.
- Copy into the same folder as the source creates the `(2)` copy without prompting.
- Quick Look: `Space` toggles, `Esc`/`Space` closes, ←/→ (↑/↓ in list view) navigate; text cap 1 MB (1048576 bytes), beyond it show a "too large" notice; folders show name + item count/size, no preview body.
- Files and styling follow the existing M3 components (`Dialog`, `Button`, `Icon`, CSS tokens `--md-sys-color-*`).
- Tests live in `src/utils/__tests__/` and `electron/__tests__/` using `bun:test`; run with `bun test <path>`.

## Review Focus

1. Cut-paste or "Replace" where source path equals destination path must never trash or lose the source (cut → silent no-op; copy → Keep both). Pinned in Task 1.
2. Pasting a folder into itself or a descendant fails for that item only; remaining items still paste and the failure is counted, no crash. Pinned in Task 1.
3. A burst of filesystem events (e.g. extracting a large archive) causes a bounded number of reloads, and a slow listing for a directory the user already left must not overwrite the current view. Pinned in Tasks 3 and 4.
4. Quick Look on filenames containing `#`, `?`, `%`, spaces, or unicode must load correctly; unreadable, binary, or removed files and unsupported codecs degrade to the info panel, never a blank/broken overlay. Pinned in Tasks 5 and 6.
5. `Space` with an empty selection, or typing in an input/terminal, does nothing; ←/→ at list ends clamp (no wrap/crash); a file removed by a live refresh while open closes or advances the overlay. Pinned in Tasks 6 and 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/utils/pasteRunner.ts` (new) | Pure paste algorithm with injected IO |
| `src/components/ConflictDialog.tsx` (new) | M3 dialog for Replace / Skip / Keep both |
| `src/hooks/usePaste.tsx` (new) | Wires runner to FileSystemService, clipboard, toasts, dialog |
| `electron/dirWatcher.ts` (new) | Debounced non-recursive watcher registry |
| `src/hooks/useDirWatch.ts` (new) | Renderer subscription to watcher events |
| `electron/textPreview.ts` (new) | Size-capped, binary-safe text reader |
| `src/utils/quickLook.ts` (new) | Preview kind, media URL, index clamp |
| `src/components/QuickLook.tsx` / `.css` (new) | Overlay UI |
| `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts` | New IPC channels |
| `src/App.tsx`, `src/components/ExplorerTab.tsx`, `src/components/FileList.tsx`, `src/utils/fileUtils.ts` | Wiring |

---

### Task 1: Paste runner (pure logic)

**Files:**
- Create: `src/utils/pasteRunner.ts`
- Test: `src/utils/__tests__/pasteRunner.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ConflictAction = 'replace' | 'skip' | 'keep-both' | 'cancel';
  export interface PasteDeps {
    exists(path: string): Promise<boolean>;
    copy(src: string, dest: string): Promise<unknown>;
    move(src: string, dest: string): Promise<unknown>;
    trash(path: string): Promise<unknown>;
    resolveConflict(file: IFile, destPath: string, remaining: number): Promise<{ action: ConflictAction; applyToAll: boolean }>;
  }
  export interface PasteResult { done: number; skipped: number; failed: string[]; cancelled: boolean }
  export function getUniqueName(name: string, taken: (candidate: string) => Promise<boolean>): Promise<string>;
  export function isSameOrDescendant(parent: string, child: string): boolean;
  export function runPaste(files: IFile[], operation: 'copy' | 'cut', destDir: string, deps: PasteDeps): Promise<PasteResult>;
  ```
  `getUniqueName('a.txt', …)` → `'a (2).txt'`; dotfiles/no extension: `'Makefile'` → `'Makefile (2)'`, `'.env'` → `'.env (2)'`; multi-dot uses last dot (`'a.tar.gz'` → `'a.tar (2).gz'`).

- [ ] **Step 1: Write failing tests** in `pasteRunner.test.ts` using an in-memory fake `PasteDeps` (a `Set<string>` of existing paths, call log array):
  - `getUniqueName` cases above, plus skips `(2)` when taken → `(3)`.
  - `isSameOrDescendant('/a/b', '/a/b')` true, `('/a/b','/a/b/c')` true, `('/a/b','/a/bc')` false.
  - no conflict: copy calls `copy` once, result `{done:1, skipped:0, failed:[], cancelled:false}`; `resolveConflict` never called.
  - conflict + `replace`: call log is `trash(dest)` then `copy(src,dest)`; if `trash` rejects, `copy` is NOT called and item is in `failed`.
  - conflict + `skip`: no IO, `skipped:1`. `keep-both`: copies to `name (2).ext`.
  - `applyToAll:true` on first of 3 conflicts → `resolveConflict` called once, action reused for the rest.
  - `cancel` on item 2 of 3 → item 1 done, items 2–3 untouched, `cancelled:true`.
  - same-folder copy (`/d/a.txt` → `/d`): no prompt, copies to `/d/a (2).txt`. Same-folder cut: no IO, `skipped:1`, no trash (Review Focus 1).
  - replace where `src === dest` for copy is never reached (covered by same-folder rule); assert `trash` never called with the source path in either same-folder test.
  - folder `/x/dir` pasted into `/x/dir` and `/x/dir/sub`: that item in `failed`, no IO; next item still pasted (Review Focus 2).
  - copy/move rejecting for one item → in `failed`, loop continues.
- [ ] **Step 2: Run** `bun test src/utils/__tests__/pasteRunner.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `pasteRunner.ts` per the signatures. Dest path join must handle `destDir === '/'`. Failed entries hold the file name.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/utils/pasteRunner.ts src/utils/__tests__/pasteRunner.test.ts
  git commit -m "feat(paste): add conflict-aware paste runner"
  ```

---

### Task 2: Conflict dialog and shared paste hook

**Files:**
- Create: `src/components/ConflictDialog.tsx`, `src/hooks/usePaste.tsx`
- Modify: `src/App.tsx:239-262` (replace `handlePaste` body), `src/components/ExplorerTab.tsx:382-411` (Ctrl+V branch), `ExplorerTab` props

**Interfaces:**
- Consumes: `runPaste`, `PasteDeps`, `ConflictAction` (Task 1); `useClipboard()`, `useToast()`, `FileSystemService.copy/move/trash`, `window.electron.exists`.
- Produces:
  ```ts
  // usePaste.tsx
  export function usePaste(onFinished: () => void): { paste: (destDir: string) => Promise<void>; conflictDialog: React.ReactNode };
  // ConflictDialog.tsx
  interface ConflictDialogProps { open: boolean; fileName: string; isDirectory: boolean; showApplyAll: boolean;
    onChoose: (action: Exclude<ConflictAction,'cancel'>, applyToAll: boolean) => void; onCancel: () => void }
  // ExplorerTab new optional prop
  onPasteRequest?: (destDir: string) => void;
  ```

- [ ] **Step 1: Implement `ConflictDialog`** using the existing `Dialog` and `Button` (`Skip` text, `Keep both` tonal, `Replace` filled; Cancel via `onCancel`/Esc). Copy: title `"{fileName}" already exists`; body "Choose what to do with this item." plus a checkbox labelled "Apply to all remaining items" only when `showApplyAll`.
- [ ] **Step 2: Implement `usePaste`.** `paste(destDir)` returns immediately if clipboard is empty or `destDir` starts with `app://`. It builds `PasteDeps` from `FileSystemService`/`window.electron.exists`; `resolveConflict` opens the dialog via state and returns a Promise resolved by `onChoose`/`onCancel` (`cancel`). `showApplyAll` is `remaining > 1`. After `runPaste`: clear clipboard only when operation is `cut` and `cancelled` is false and there were no failures; toast `Pasted N item(s)` (success), `Skipped N`, and `Failed to paste: <names>` (error) as applicable; always call `onFinished()` when `done > 0`. Concurrent calls while a paste is running are ignored.
- [ ] **Step 3: Wire `App.tsx`**: replace `handlePaste` with `const { paste, conflictDialog } = usePaste(refreshActiveTab)`; the context-menu Paste action calls `paste(currentPath)` then closes the menu; render `{conflictDialog}` next to the other dialogs; pass `onPasteRequest={paste}` to every `ExplorerTab`.
- [ ] **Step 4: Wire `ExplorerTab.tsx`**: the Ctrl+V branch calls `onPasteRequest?.(currentPath)` (guard stays: not on `app://dashboard`); delete the inline copy/move loop and now-unused `clearClipboard`/`clipboard` usages if lint flags them.
- [ ] **Step 5: Verify**: `bunx tsc -b` (no errors), `bun run lint` (no new errors), `bun test` (all pass). Manual checklist: paste a file into a folder holding the same name → dialog appears; each of Replace (old one lands in Trash), Skip, Keep both behaves; multi-select with "Apply to all"; Esc cancels remaining items.
- [ ] **Step 6: Commit**
  ```bash
  git add src/components/ConflictDialog.tsx src/hooks/usePaste.tsx src/App.tsx src/components/ExplorerTab.tsx
  git commit -m "feat(paste): add conflict dialog and shared paste hook"
  ```

---

### Task 3: Directory watcher (main process)

**Files:**
- Create: `electron/dirWatcher.ts`
- Test: `electron/__tests__/dirWatcher.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WatchEvent = { id: number; type: 'change' } | { id: number; type: 'error'; message: string };
  export class DirWatchers {
    constructor(emit: (e: WatchEvent) => void, debounceMs?: number); // default 150
    start(dir: string): number;      // returns watcher id; emits 'error' (not throw) if dir cannot be watched
    stop(id: number): void;          // idempotent
    stopAll(): void;
  }
  ```

- [ ] **Step 1: Write failing tests** with a temp dir (`fs.mkdtempSync`) and `debounceMs = 30`:
  - creating a file emits exactly one `change` for that id within 500ms.
  - creating 50 files in a tight loop emits ≤ 3 `change` events (Review Focus 3).
  - after `stop(id)`, creating a file emits nothing (wait 200ms); calling `stop` twice does not throw.
  - `start('/nonexistent/xyz')` emits one `error` event and returns an id; `stop(id)` is safe.
  - deleting the watched directory emits an `error` or `change` event (either is accepted) and does not throw.
  - `stopAll()` stops every watcher.
- [ ] **Step 2: Run** `bun test electron/__tests__/dirWatcher.test.ts` → FAIL.
- [ ] **Step 3: Implement** with `fs.watch(dir, { persistent: false })`; per-watcher trailing-edge debounce timer; clear the timer in `stop`; attach `'error'` handler on the `FSWatcher` that emits `error` and closes it.
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add electron/dirWatcher.ts electron/__tests__/dirWatcher.test.ts
  git commit -m "feat(watch): add debounced directory watcher"
  ```

---

### Task 4: Live refresh wiring

**Files:**
- Modify: `electron/main.ts` (new handlers; `stopAll` in `window-all-closed`), `electron/preload.ts`, `src/types/electron.d.ts`, `src/components/ExplorerTab.tsx`
- Create: `src/hooks/useDirWatch.ts`

**Interfaces:**
- Consumes: `DirWatchers`, `WatchEvent` (Task 3).
- Produces:
  ```ts
  // IPC: ipcMain.handle('fs:watch-start', (event, dir) => number); ipcMain.handle('fs:watch-stop', (_, id) => void);
  // main → renderer: webContents.send('fs:watch-event', WatchEvent)
  // IElectronAPI additions:
  watchStart: (dir: string) => Promise<number>;
  watchStop: (id: number) => Promise<void>;
  onWatchEvent: (cb: (e: WatchEvent) => void) => () => void;
  // useDirWatch.ts
  export function useDirWatch(dir: string | null, enabled: boolean, onEvent: (type: 'change' | 'error') => void): void;
  ```
  `useDirWatch` starts a watcher when `enabled && dir` is set and not `app://…`, filters events by its own id, and stops on change/unmount. It must tolerate `watchStart` resolving after unmount (stop the late id immediately).

- [ ] **Step 1: Add IPC handlers, preload bridge and types** as specified. Emit via `mainWindow?.webContents.send`.
- [ ] **Step 2: Add `useDirWatch`** per the interface.
- [ ] **Step 3: ExplorerTab silent reload.** Add `reloadSilently()`: lists `currentPathRef.current`, discards the result if `currentPathRef.current` changed meanwhile or `searchActive`, calls `setFiles` without `setLoading`, and prunes `selectedFiles` to paths still present. Call `useDirWatch(currentPath, isActive, handler)`: on `change` run `reloadSilently` unless a drag is in progress (track with `dragstart`/`dragend` on the list container into a ref); on `error`, if `window.electron.exists(currentPath)` is false, walk `getParentPath` until an existing directory is found, `loadPath` it, and `showToast('Folder no longer exists', 'info')`.
- [ ] **Step 4: Refresh on re-activation.** When `isActive` flips to true after mount, call `reloadSilently()` once (inactive tabs are not watched).
- [ ] **Step 5: Verify**: `bunx tsc -b`, `bunx tsc -p electron/tsconfig.json --noEmit`, `bun run lint`, `bun test`. Manual: from a terminal `touch`/`rm` files in the open folder → list updates without flicker and selection kept; `rm -r` the open folder → toast and navigates to the parent; switch tabs and back → list is current.
- [ ] **Step 6: Commit**
  ```bash
  git add electron src/hooks/useDirWatch.ts src/types/electron.d.ts src/components/ExplorerTab.tsx
  git commit -m "feat(watch): live-refresh the open directory"
  ```

---

### Task 5: Text preview reader (main process)

**Files:**
- Create: `electron/textPreview.ts`
- Test: `electron/__tests__/textPreview.test.ts`
- Modify: `electron/main.ts`, `electron/preload.ts`, `src/types/electron.d.ts`

**Interfaces:**
- Produces:
  ```ts
  export const TEXT_PREVIEW_MAX_BYTES = 1048576;
  export type TextPreview =
    | { kind: 'text'; content: string }
    | { kind: 'too-large'; size: number }
    | { kind: 'binary' }
    | { kind: 'error' };
  export function readTextPreview(filePath: string, maxBytes?: number): Promise<TextPreview>;
  // IPC 'fs:read-text-preview' → readTextPreview; IElectronAPI: readTextPreview: (path: string) => Promise<TextPreview>;
  ```

- [ ] **Step 1: Write failing tests** with temp files: small utf-8 incl. unicode → `text`; empty file → `{kind:'text', content:''}`; file of `maxBytes+1` bytes (pass `maxBytes=10`) → `too-large` with `size`; file with a `\0` byte in the first 8 KB → `binary`; missing path → `error`; a directory path → `error`.
- [ ] **Step 2: Run** `bun test electron/__tests__/textPreview.test.ts` → FAIL.
- [ ] **Step 3: Implement** with `fs.stat` size check, then read; detect binary by a null byte in the first 8192 bytes.
- [ ] **Step 4: Run** → PASS. Then register the IPC handler, preload method and type; run `bunx tsc -p electron/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit**
  ```bash
  git add electron src/types/electron.d.ts
  git commit -m "feat(quicklook): add size-capped text preview reader"
  ```

---

### Task 6: Quick Look helpers

**Files:**
- Modify: `src/utils/fileUtils.ts` (add `isVideoFile`, `isAudioFile`, `isPdfFile`, `isTextFile`, same style as `isImageFile`), `src/components/FileList.tsx:191` (thumbnail uses `toMediaUrl`)
- Create: `src/utils/quickLook.ts`
- Test: `src/utils/__tests__/quickLook.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'folder' | 'other';
  export function getPreviewKind(file: IFile): PreviewKind;
  export function toMediaUrl(path: string): string;   // 'media://' + path split on '/', each segment encodeURIComponent'd
  export function stepIndex(index: number, length: number, delta: number): number; // clamped to [0, length-1]; -1 when length is 0
  ```
  `isTextFile` covers `txt, md, csv, log, conf, ini, toml, json` plus every extension in the code set; `isVideoFile`/`isAudioFile` reuse the existing extension sets.

- [ ] **Step 1: Write failing tests**:
  - `getPreviewKind`: `a.PNG`→image, `a.mkv`→video, `a.flac`→audio, `a.pdf`→pdf, `a.ts`→text, `a.xyz`→other, directory named `x.png`→folder.
  - `toMediaUrl('/home/u/a b#1?.png')` → `'media:///home/u/a%20b%231%3F.png'`; `toMediaUrl('/home/u/ünï.png')` round-trips: `decodeURIComponent` of the part after `media://` equals the original path; `%` in names encoded as `%25`.
  - `stepIndex(0,5,-1)`→0, `(4,5,1)`→4, `(2,5,1)`→3, `(0,0,1)`→-1.
- [ ] **Step 2: Run** `bun test src/utils/__tests__/quickLook.test.ts` → FAIL.
- [ ] **Step 3: Implement** the helpers; update the thumbnail `src` in `FileList.tsx` to `toMediaUrl(file.path)`.
- [ ] **Step 4: Run** the new test and `bun test src/utils/__tests__/fileUtils.test.ts` → PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/utils src/components/FileList.tsx
  git commit -m "feat(quicklook): add preview kind, media URL and index helpers"
  ```

---

### Task 7: Quick Look overlay

**Files:**
- Create: `src/components/QuickLook.tsx`, `src/components/QuickLook.css`
- Modify: `src/components/ExplorerTab.tsx`

**Interfaces:**
- Consumes: `getPreviewKind`, `toMediaUrl`, `stepIndex` (Task 6); `window.electron.readTextPreview` (Task 5); `getDirectorySize`, `listDir`, `FileSystemService.open`; `getFileIconInfo`, `formatFileSize`, `formatFileDate`.
- Produces:
  ```ts
  interface QuickLookProps {
    file: IFile;
    files: IFile[];                 // current sorted list, used for navigation
    viewMode: 'grid' | 'list';      // list → ↑/↓ navigate, grid → ←/→ (←/→ always work)
    onClose: () => void;
    onNavigate: (file: IFile) => void;
    onOpen: (file: IFile) => void;
  }
  ```

- [ ] **Step 1: Implement `QuickLook`.** Full-window overlay with scrim, M3 surface-container card, header (icon, name, size, modified date, close and "Open" buttons). Body by `getPreviewKind`: `image` → `<img>`; `video`/`audio` → controls with `autoPlay` off; `pdf` → `<iframe>`; `text` → fetch via `readTextPreview` and show in `<pre>` (monospace, scrollable) or the notices "File is too large to preview (X)", "Binary file", "Couldn't read file"; `folder` → icon, "N items" from `listDir` and size from `getDirectorySize` shown as "Calculating…" until it resolves; `other` → large icon plus info. Any media `onError` switches the body to the `other` info panel. A cancelled-effect guard prevents a late async result from showing for a different file.
- [ ] **Step 2: Keyboard handling inside `QuickLook`.** One `window` `keydown` listener in the capture phase: `Escape`/`Space` → `preventDefault`, `stopPropagation`, `onClose`; arrows → `stepIndex` against `files`, `onNavigate(files[next])` (no-op at the ends); ignore events whose target is INPUT/TEXTAREA/contentEditable.
- [ ] **Step 3: Wire `ExplorerTab`.** State `quickLookPath: string | null`. In the keyboard handler: `Space` (no modifiers) with `selectedFiles.size > 0` and not on `app://dashboard` → `preventDefault`, open on the last-selected visible file (fall back to the first selected in `sortedFiles`). Render `<QuickLook>` when the path resolves to a file in `sortedFiles`; `onNavigate` calls `handleSelect(file, false, false)` and updates `quickLookPath`; `onOpen` calls `handleNavigate`. If `quickLookPath` is no longer in `sortedFiles` (removed by a live refresh), move to the nearest remaining neighbour or close when the list is empty (Review Focus 5). Close the overlay when the tab becomes inactive or the directory changes.
- [ ] **Step 4: Verify**: `bunx tsc -b`, `bun run lint`, `bun test`. Manual: Space on image / mp4 / mp3 / pdf / `.ts` / a 2 MB text file / a binary / a folder; names with `#` and `%`; arrows at both list ends; Space with nothing selected and while typing in the Omnibar; delete the previewed file from a terminal while open; an unsupported-codec video falls back to the info panel.
- [ ] **Step 5: Commit**
  ```bash
  git add src/components/QuickLook.tsx src/components/QuickLook.css src/components/ExplorerTab.tsx
  git commit -m "feat(quicklook): add Space-to-preview overlay"
  ```

---

## Final Verification

- [ ] `bun test` → all pass; `bunx tsc -b` and `bunx tsc -p electron/tsconfig.json --noEmit` → no errors; `bun run lint` → no new errors.
- [ ] Run the manual checklists of Tasks 2, 4, 7 once more on `bun run electron:dev`.
