# Native GTK3 Outbound Drag-and-Drop & Unified Internal Drop Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WebKitGTK HTML5 outbound `DataTransfer` with a native Linux GTK3 drag source (`text/uri-list` + `text/plain`) so external Wayland/XWayland apps (including `photos0x`, browsers, and terminals) reliably receive file and folder drops, while adding unified internal and external drop targeting for `FileList` subfolders, `Sidebar` (`Places`, `Devices`, `Trash`), and `TabBar` tabs.

**Architecture:** A Linux `src-tauri/src/native_drag.rs` module captures the WebKitGTK button-1 `gdk::Event` press serial and launches `gtk::ApplicationWindow::drag_begin_with_coordinates` (`COPY`, Cairo HiDPI pill icon, `fs:native-drag-ended` signal). On the frontend, a single `App.tsx` coordinator (`useAppDragDrop`) consumes `api.onDragDrop` (unscaled GTK3 widget-space coordinates) and `api.onNativeDragEnd` to hit-test targets via pure `dropTargetUtils`, drive 550ms tab spring-loading and edge auto-scrolling, and dispatch clipboard-isolated moves (`usePaste.transferFiles`), copies (`processInboundDrop`), or trash (`handleTrashRequest`).

**Tech Stack:** Rust / Tauri v2 (`tauri 2.12`, `gtk 0.18`, `gdk 0.18`, `url 2`), React 19, TypeScript 5.9, Tailwind CSS v4, `@bug-on/m3-expressive`, Bun test (`bun test`), Cargo test (`cargo test`).

**Spec:** `docs/superpowers/specs/2026-11-26-native-drag-drop-and-internal-targets-design.md`

## Global Constraints

- Zero new external Rust/npm crates outside `Cargo.lock`: add only `[target.'cfg(target_os = "linux")'.dependencies]` `gtk = "0.18"` and `gdk = "0.18"` in `src-tauri/Cargo.toml`; non-Linux compiles with a clean no-op stub.
- Initiate `drag_begin_with_coordinates` on `window.gtk_window()` (`gtk::ApplicationWindow`)—never on `webkit2gtk::WebView`—using the cached button-1 `gdk::Event` from `webview.connect_button_press_event`, with `gdk::DragAction::COPY` and targets `add_uri_targets(1)` (no trailing `/` on directory URIs) + `add_text_targets(2)`.
- `wry` (`0.57.2`) forwards GTK3 widget-logical `(x, y)` coordinates verbatim; `toCssClientPoint` must NOT divide by `window.devicePixelRatio`.
- Virtualized `FileList` row/card heights (`h-14` / 56px in List view, `getGridCardHeight(iconSize)` in Grid view) must not change when drop-active highlights (`ring-2 ring-inset ring-m3-primary bg-m3-primary-container/35`) are applied.
- Internal drag transfers must never read, mutate, or clear `ClipboardContext`.
- `src/api/__tests__/commandParity.test.ts` must stay green at `40` registered commands (`start_native_drag` added; `onNativeDragEnd` excluded from `CommandKey`).
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml`, `bun test`, `bunx tsc -b`, `bun run lint`, and `bun run build` must all pass with zero warnings/errors.

## Review Focus

1. **Mixed valid + same-folder multi-item drop** (e.g. dragging search hits `/home/u/Docs/a.txt` and `/home/u/a.txt` onto `/home/u`): must remain droppable and move/copy only `/home/u/Docs/a.txt` rather than rejecting the whole batch or failing on same-parent. *(Pinned in Task 3)*
2. **Stale/cancelled drag when button 1 is already released before IPC reaches GTK** (`startNativeDrag` returns `false` or rejects): must immediately clear `isDragging` and `internalSessionRef` instead of getting stuck for 15s and pausing `useDirWatch`. *(Pinned in Task 1 & Task 5)*
3. **Drag leaving window to external app (`photos0x`) and releasing externally**: `onDragDrop` `leave` must clear hover highlights and timers without clearing `internalSessionRef` prematurely, and `onNativeDragEnd` must subsequently clear `isDragging` and flush deferred reloads. *(Pinned in Task 5)*
4. **Synthetic `click` after `onDragStart` calls `e.preventDefault()` on an already-selected folder**: must suppress the click so dragging or cancelling never triggers single-click-to-open navigation (`FileList.tsx:455`). *(Pinned in Task 6)*
5. **Partial conflict skip/cancel during drag-move from active search results**: only actually moved paths (`completedSourcePaths`) may be pruned from the search list; skipped/cancelled items stay visible and `ClipboardContext` stays untouched. *(Pinned in Task 4 & Task 7)*

## File Structure Map

| File | Responsibility |
| :--- | :--- |
| `src-tauri/Cargo.toml` | Enable Linux-only `gtk = "0.18"` and `gdk = "0.18"` from existing `Cargo.lock` |
| `src-tauri/src/native_drag.rs` | Pure URI/path/badge helpers + Linux GTK3 button-press cache, `drag_begin_with_coordinates`, Cairo drag pill, `fs:native-drag-ended` emitter, and non-Linux stub |
| `src-tauri/src/commands/app.rs` | `start_native_drag` Tauri command |
| `src-tauri/src/lib.rs` | Register `native_drag` module, `.setup()` hook on `"main"`, and `start_native_drag` handler |
| `src/api/types.ts`, `commandMap.ts`, `tauriAdapter.ts` | `NativeDragRequest`, `startNativeDrag`, `onNativeDragEnd` IPC seam |
| `src/utils/dropTargetUtils.ts` | Pure drop eligibility, path filtering, DOM target resolution, coordinate pass-through, and auto-scroll math |
| `src/utils/pasteRunner.ts`, `src/hooks/usePaste.tsx` | `completedSourcePaths` tracking and clipboard-isolated `transferFiles` |
| `src/hooks/useAppDragDrop.ts` | App-level `onDragDrop` + `onNativeDragEnd` coordinator, 550ms tab spring-loading, edge auto-scroll |
| `src/components/FileList.tsx`, `Sidebar.tsx`, `TabBar.tsx` | Outbound native drag start, click suppression, `data-drop-*` attributes, inset highlights |
| `src/utils/explorerTabUtils.ts`, `src/components/ExplorerTab.tsx`, `src/App.tsx` | Coordinator wiring, `isDragging` watcher deferral, directory-scoped refresh, and search-mode path pruning |

---

### Task 1: Rust Native GTK3 Drag Module & `start_native_drag` Command

**Files:**
- Modify: `src-tauri/Cargo.toml:15-31`
- Create: `src-tauri/src/native_drag.rs`
- Modify: `src-tauri/src/commands/app.rs`
- Modify: `src-tauri/src/lib.rs:1-32,146-218`

**Interfaces:**
- Consumes: `tauri::WebviewWindow`, `tauri::AppHandle::emit`, `url::Url::from_file_path`, Linux `gtk = "0.18"`, `gdk = "0.18"`, `webkit2gtk::WebView`.
- Produces:
  - `crate::native_drag::{validate_drag_paths, format_file_uris, format_plain_paths, build_drag_badge_text, can_begin_drag, install_for_window, start_drag_on_window}`
  - Tauri command `commands::app::start_native_drag(window: tauri::WebviewWindow, paths: Vec<String>, label: Option<String>, is_directory: bool) -> Result<bool, String>`
  - Emitted window event `"fs:native-drag-ended"` (`()` payload).

- [ ] **Step 1: Add Linux `gtk` / `gdk` deps to `src-tauri/Cargo.toml` and write failing unit tests in `src-tauri/src/native_drag.rs`**

Add under `[dependencies]` in `src-tauri/Cargo.toml`:
```toml
[target.'cfg(target_os = "linux")'.dependencies]
gtk = "0.18"
gdk = "0.18"
```
Create `src-tauri/src/native_drag.rs` with `pub mod` stubs (`todo!()`) and `#[cfg(test)] mod tests`:
- `validate_drag_paths_rejects_empty_relative_and_nul_and_deduplicates`: asserts `Err` on `[]`, `["rel/a.txt"]`, `["/tmp/bad\0.txt"]`, and asserts `["/a.txt", "/b", "/a.txt"] -> Ok(["/a.txt", "/b"])`.
- `format_file_uris_encodes_spaces_utf8_hash_percent_and_omits_dir_trailing_slash`: asserts `/tmp/my folder/café #1%.png` encodes to `file:///tmp/my%20folder/caf%C3%A9%20%231%25.png` and `/tmp/my dir/` omits the trailing slash (`file:///tmp/my%20dir`).
- `format_plain_paths_joins_with_newlines`: asserts `["/a", "/b c"] -> "/a\n/b c"`.
- `build_drag_badge_text_single_multi_and_truncation`: asserts single item uses label/basename, multi item formats `"<primary> (+2)"`, and names >28 chars truncate cleanly with `"..."` while preserving `" (+N)"`.
- `start_drag_returns_false_when_button_not_pressed_state`: asserts `can_begin_drag(false, true) == false`, `can_begin_drag(true, false) == false`, and `can_begin_drag(true, true) == true`.

Declare `pub mod native_drag;` in `src-tauri/src/lib.rs`.

- [ ] **Step 2: Run Rust tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml native_drag`
Expected: FAIL (`not yet implemented` / compile or panic in `native_drag::tests`).

- [ ] **Step 3: Implement `src-tauri/src/native_drag.rs`, `start_native_drag` in `commands/app.rs`, and wire in `lib.rs`**

1. Implement pure helpers in `src-tauri/src/native_drag.rs`:
   - `pub fn validate_drag_paths(paths: &[String]) -> Result<Vec<String>, String>`
   - `pub fn format_file_uris(paths: &[String]) -> Vec<String>` (normalize trailing `/` except root `"/"` before `url::Url::from_file_path`)
   - `pub fn format_plain_paths(paths: &[String]) -> String`
   - `pub fn build_drag_badge_text(paths: &[String], label: Option<&str>) -> String`
   - `pub fn can_begin_drag(button1_pressed: bool, has_press_event: bool) -> bool`
2. Implement Linux GTK3 integration (`#[cfg(target_os = "linux")]`):
   - Maintain thread-local `RefCell<HashMap<String, Rc<RefCell<WindowDragState>>>>` on the GTK main thread keyed by window label, storing `last_press_event: Option<gdk::Event>`, `button1_pressed: bool`, `last_pos: (i32, i32)`, and `active_payload: Option<ActiveDragPayload>` (`uris`, `plain`, `badge`, `is_directory`).
   - `pub fn install_for_window(window: &tauri::WebviewWindow)`:
     - Capture `gtk_window = window.gtk_window()` and `app_handle = window.app_handle().clone()`.
     - Via `window.with_webview(...)`, connect on `webview.inner()` (returning `gtk::glib::Propagation::Proceed` from every hook):
       - `connect_button_press_event`: when `event.button() == 1`, record `last_press_event = Some(event.as_ref().clone())`, `button1_pressed = true`, and `last_pos = (x as i32, y as i32)`.
       - `connect_motion_notify_event`: update `last_pos` while `button1_pressed` is true.
       - `connect_button_release_event`: when `event.button() == 1`, set `button1_pressed = false`.
     - Connect on `gtk_window`:
       - `connect_drag_data_get`: for `info == 1` call `selection_data.set_uris(&uri_refs)`; for `info == 2` call `selection_data.set_text(&payload.plain)`.
       - `connect_drag_begin`: render a HiDPI Cairo `ImageSurface` rounded pill (`gtk::cairo`, scaled by `gtk_window.scale_factor()`, `set_device_offset(-16.0, -20.0)`) showing a folder/file glyph and `payload.badge`, calling `context.drag_set_icon_surface(&surface)` with fallback `context.drag_set_icon_name(...)`.
       - `connect_drag_end` and `connect_drag_failed`: clear `active_payload`, set `button1_pressed = false`, emit `let _ = app_handle.emit("fs:native-drag-ended", ());` (returning `gtk::glib::Propagation::Proceed` from `drag_failed`).
   - `pub async fn start_drag_on_window(window: tauri::WebviewWindow, paths: Vec<String>, label: Option<String>, is_directory: bool) -> Result<bool, String>`:
     - Validate paths with `validate_drag_paths(&paths)?`.
     - Dispatch synchronously onto the GTK main thread via `window.run_on_main_thread(...)` + `tokio::sync::oneshot` (250ms timeout via `tokio::time::timeout`).
     - On the GTK main thread: verify `can_begin_drag(state.button1_pressed, state.last_press_event.is_some())` (return `Ok(false)` if not), build `gtk::TargetList::new(&[])` with `add_uri_targets(1)` and `add_text_targets(2)`, store `ActiveDragPayload`, and call `gtk_window.drag_begin_with_coordinates(&targets, gdk::DragAction::COPY, 1, press_event.as_ref(), x, y)`; return `Ok(true)` if `Some(_ctx)` else clear `active_payload` and return `Ok(false)`.
3. Implement `#[cfg(not(target_os = "linux"))]` stubs for `install_for_window` and `start_drag_on_window` (validating paths and returning `Ok(false)`).
4. Add `#[tauri::command(rename_all = "camelCase")] pub async fn start_native_drag(window: tauri::WebviewWindow, paths: Vec<String>, label: Option<String>, is_directory: bool) -> Result<bool, String>` in `src-tauri/src/commands/app.rs`.
5. Register `commands::app::start_native_drag` in `tauri::generate_handler![...]` and call `if let Some(main_window) = app.get_webview_window("main") { native_drag::install_for_window(&main_window); }` in `.setup()` inside `src-tauri/src/lib.rs`.

- [ ] **Step 4: Run Rust tests and Clippy to verify**

Run: `cargo test --manifest-path src-tauri/Cargo.toml native_drag && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: PASS (all `native_drag::tests` pass, zero clippy warnings).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/native_drag.rs src-tauri/src/commands/app.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add Linux GTK3 native outbound drag source and start_native_drag command"
```

---

### Task 2: TypeScript IPC Seam (`startNativeDrag`, `onNativeDragEnd`) & Command Parity

**Files:**
- Modify: `src/api/types.ts:1-95`
- Modify: `src/api/commandMap.ts:1-48`
- Modify: `src/api/tauriAdapter.ts:1-215`
- Modify: `src/api/__tests__/commandParity.test.ts:49-52`
- Modify: `src/api/__tests__/tauriAdapter.test.ts:16-21,166-192`

**Interfaces:**
- Consumes: Rust command `start_native_drag` and event `'fs:native-drag-ended'` from Task 1.
- Produces:
  - `export interface NativeDragRequest { paths: string[]; label?: string; isDirectory?: boolean; }`
  - `IApi.startNativeDrag: (req: NativeDragRequest) => Promise<boolean>`
  - `IApi.onNativeDragEnd: (cb: () => void) => () => void`

- [ ] **Step 1: Write failing parity and adapter tests**

In `src/api/__tests__/commandParity.test.ts`, update the test name and assertion from `39` to `40`.
In `src/api/__tests__/tauriAdapter.test.ts`:
- Assert `expect(typeof adapter.onNativeDragEnd).toBe('function');` in `'every COMMAND_MAP key exists on the adapter'`.
- Add test `'startNativeDrag calls start_native_drag with normalized args'` verifying `{ paths: ['/tmp/a.png'], label: 'a.png', isDirectory: false }` when `isDirectory` is omitted and `{ paths: ['/tmp/dir'], label: undefined, isDirectory: true }` when `isDirectory: true`.
- Add test `'onNativeDragEnd subscribes to fs:native-drag-ended and supports early unsubscribe'` verifying callback invocation on `'fs:native-drag-ended'` and unlisten cleanup if unsubscribed before `listen` resolves.

- [ ] **Step 2: Run parity and adapter tests to verify they fail**

Run: `bun test src/api/__tests__/commandParity.test.ts src/api/__tests__/tauriAdapter.test.ts`
Expected: FAIL (`Missing commands` / `adapter.startNativeDrag is not a function`).

- [ ] **Step 3: Implement `NativeDragRequest`, `startNativeDrag`, and `onNativeDragEnd` in `src/api/`**

- In `src/api/types.ts`: define `NativeDragRequest` and add `startNativeDrag` + `onNativeDragEnd` to `IApi`.
- In `src/api/commandMap.ts`: add `'onNativeDragEnd'` to `CommandKey`'s `Exclude` union and `startNativeDrag: 'start_native_drag'` to `COMMAND_MAP`.
- In `src/api/tauriAdapter.ts`: implement `startNativeDrag` (forwarding `{ paths: req.paths, label: req.label, isDirectory: req.isDirectory ?? false }`) and `onNativeDragEnd` (via `wrapListener(listen('fs:native-drag-ended', () => cb()))`).

- [ ] **Step 4: Run parity, adapter, and typecheck tests**

Run: `bun test src/api/__tests__/commandParity.test.ts src/api/__tests__/tauriAdapter.test.ts && bunx tsc -b`
Expected: PASS (40 commands exact match, all adapter tests pass, `tsc -b` exits 0).

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/commandMap.ts src/api/tauriAdapter.ts src/api/__tests__/commandParity.test.ts src/api/__tests__/tauriAdapter.test.ts
git commit -m "feat(api): expose startNativeDrag and onNativeDragEnd in Tauri API client"
```

---

### Task 3: Pure Drop-Target Resolution, Outbound Drag Selection & Auto-Scroll Utilities

**Files:**
- Create: `src/utils/dropTargetUtils.ts`
- Create: `src/utils/__tests__/dropTargetUtils.test.ts`

**Interfaces:**
- Consumes: `IFile` (`src/types/files.ts`), `normalizePath` (`src/utils/navigationHistory.ts`), `isSameOrDescendant` (`src/utils/pasteRunner.ts`).
- Produces:
  - `export type ResolvedDropTarget = { kind: 'folder'; path: string; source: 'filelist' | 'sidebar' | 'explorer-root' } | { kind: 'tab'; tabId: string; path: string } | { kind: 'trash' };`
  - `export interface DropElementLike { closest(selector: string): DropElementLike | null; getAttribute(name: string): string | null; }`
  - `export function collectOutboundDragItems(clickedFile: IFile, sortedFiles: IFile[], selectedFiles: Set<string>): IFile[]`
  - `export function canDropPathsIntoDir(paths: string[], destDir: string, mode: 'move' | 'copy'): boolean`
  - `export function filterActionablePathsForDir(paths: string[], destDir: string, mode: 'move' | 'copy'): string[]`
  - `export function resolveDropTargetFromElement(el: DropElementLike | null, draggedPaths: string[], mode: 'move' | 'copy', tabsById: Map<string, { path: string }>): ResolvedDropTarget | null`
  - `export function toCssClientPoint(position: { x: number; y: number }): { x: number; y: number }`
  - `export function computeAutoScrollDelta(pointerY: number, rectTop: number, rectBottom: number, edgeZonePx?: number, maxSpeedPx?: number): number`

- [ ] **Step 1: Write failing tests in `src/utils/__tests__/dropTargetUtils.test.ts`**

Write unit tests covering:
- `collectOutboundDragItems`: returns all selected `IFile`s in `sortedFiles` order when `clickedFile` is selected, else `[clickedFile]`.
- `canDropPathsIntoDir` & `filterActionablePathsForDir`:
  - Rejects empty paths, `app://...` / `search://...` destinations, relative/NUL paths, and any ancestor/self drop (`isSameOrDescendant(src, destDir)`).
  - For `mode: 'move'`, rejects when every path's parent equals `normalizePath(destDir)`; for **Review Focus #1 (mixed valid + same-folder batch)**, `canDropPathsIntoDir(['/home/u/Docs/a.txt', '/home/u/a.txt'], '/home/u', 'move')` returns `true` and `filterActionablePathsForDir` returns `['/home/u/Docs/a.txt']`.
- `resolveDropTargetFromElement`:
  - Resolves `[data-drop-trash="true"]` only for `mode: 'move'` (returns `null` for `mode: 'copy'`).
  - Resolves `[data-drop-tab-id]` for directory tabs (`{ kind: 'tab', tabId, path }`), maps `app://trash` tabs to `{ kind: 'trash' }` only for `'move'`, and rejects `app://dashboard` tabs.
  - Resolves `[data-drop-folder-path]` with `source: 'sidebar'` when nested inside `[data-drop-sidebar="true"]`, otherwise `source: 'filelist'`.
  - Resolves `[data-drop-explorer-root="true"]` only when `data-search-active !== 'true'` and `canDropPathsIntoDir` passes.
- `toCssClientPoint`: passes finite `{ x, y }` coordinates through unscaled (matching GTK3 widget coordinates) and sanitizes non-finite values to `0`.
- `computeAutoScrollDelta`: returns negative delta near top edge, positive delta near bottom edge, `0` in middle or zero-height rects.

- [ ] **Step 2: Run unit tests to verify they fail**

Run: `bun test src/utils/__tests__/dropTargetUtils.test.ts`
Expected: FAIL (`Cannot find module '../dropTargetUtils'`).

- [ ] **Step 3: Implement `src/utils/dropTargetUtils.ts`**

Implement the exact exported types and pure functions matching the Interfaces block and tests. Note: in `canDropPathsIntoDir`, validate that no path in `paths` triggers an illegal ancestor/self recursion (`isSameOrDescendant(src, destDir)`), and return `filterActionablePathsForDir(paths, destDir, mode).length > 0`.

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `bun test src/utils/__tests__/dropTargetUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/dropTargetUtils.ts src/utils/__tests__/dropTargetUtils.test.ts
git commit -m "feat(dnd): add pure drop target resolution and auto-scroll utilities"
```

---

### Task 4: Clipboard-Isolated `transferFiles` & Completed-Path Tracking in `pasteRunner` / `usePaste`

**Files:**
- Modify: `src/utils/pasteRunner.ts:17-22,72-194`
- Modify: `src/hooks/usePaste.tsx:15-131`
- Modify: `src/utils/__tests__/pasteRunner.test.ts`
- Create: `src/hooks/__tests__/usePasteTransfer.test.ts`

**Interfaces:**
- Consumes: `runPaste`, `PasteResult`, `ClipboardContext`, `ConflictDialog`.
- Produces:
  - `PasteResult` extended with `completedSourcePaths: string[]`
  - `export interface TransferCompletionInfo { operation: 'copy' | 'cut'; destDir: string; completedSourcePaths: string[]; affectedDirs: string[]; }`
  - `usePaste(onFinished: () => void, onTransferComplete?: (info: TransferCompletionInfo) => void)` returning `{ paste, transferFiles, conflictDialog }` where `transferFiles: (files: IFile[], operation: 'copy' | 'cut', destDir: string) => Promise<PasteResult>`

- [ ] **Step 1: Write failing tests in `pasteRunner.test.ts` and `usePasteTransfer.test.ts`**

- In `src/utils/__tests__/pasteRunner.test.ts`: add test `'records only succeeded source paths in completedSourcePaths across skip, cancel, keep-both, and replace'` (pinning **Review Focus #5**).
- Create `src/hooks/__tests__/usePasteTransfer.test.ts` (using React `createRoot` + `ToastProvider` + `ClipboardProvider` + mocked `api` methods):
  - Copy items into `ClipboardContext` (`Ctrl+C`), invoke `transferFiles([fileA, fileB], 'cut', '/dest')` where `fileB` hits conflict and resolves `'skip'`.
  - Assert `result.completedSourcePaths` equals `[fileA.path]`, `ClipboardContext` contents are completely unchanged, `onTransferComplete` receives `affectedDirs` containing normalized parent of `fileA` and `'/dest'`, and concurrent `transferFiles` / `paste` calls while busy are ignored via `isPastingRef`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/utils/__tests__/pasteRunner.test.ts src/hooks/__tests__/usePasteTransfer.test.ts`
Expected: FAIL (`completedSourcePaths` missing / `transferFiles` not returned).

- [ ] **Step 3: Implement `completedSourcePaths` in `pasteRunner.ts` and `transferFiles` in `usePaste.tsx`**

- In `src/utils/pasteRunner.ts`: add `completedSourcePaths: string[]` to `PasteResult` and push `file.path` whenever `result.done++` occurs.
- In `src/hooks/usePaste.tsx`:
  - Extract internal `executeTransfer(files, operation, destDir, source: 'clipboard' | 'direct')` sharing `isPastingRef` and `ConflictDialog`.
  - When `source === 'direct'`: never read or call `clearClipboard()`; toast `"Moved X item(s)"` (for `'cut'`) or `"Copied X item(s)"` (for `'copy'`); compute `affectedDirs` (unique normalized parent directories of `result.completedSourcePaths` + normalized `destDir`); invoke `onTransferCompleteRef.current?.({ operation, destDir, completedSourcePaths: result.completedSourcePaths, affectedDirs })` and `onFinishedRef.current()` when `result.done > 0`.
  - Expose `transferFiles` alongside `paste` and `conflictDialog`.

- [ ] **Step 4: Run tests and verify they pass**

Run: `bun test src/utils/__tests__/pasteRunner.test.ts src/hooks/__tests__/usePasteTransfer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/pasteRunner.ts src/hooks/usePaste.tsx src/utils/__tests__/pasteRunner.test.ts src/hooks/__tests__/usePasteTransfer.test.ts
git commit -m "feat(paste): add clipboard-isolated transferFiles and completedSourcePaths tracking"
```

---

### Task 5: App-Level Drag-and-Drop Coordinator Hook (`src/hooks/useAppDragDrop.ts`)

**Files:**
- Create: `src/hooks/useAppDragDrop.ts`
- Create: `src/hooks/__tests__/useAppDragDrop.test.ts`

**Interfaces:**
- Consumes: `api.{startNativeDrag, onDragDrop, onNativeDragEnd, exists, copyFile}`, `dropTargetUtils.*`, `processInboundDrop`, `TransferCompletionInfo` / `transferFiles`.
- Produces:
  - `export interface UseAppDragDropOptions { tabs: Array<{ id: string; path: string }>; activeTabId: string; onSelectTab: (tabId: string) => void; transferFiles: (files: IFile[], operation: 'copy' | 'cut', destDir: string) => Promise<PasteResult>; onTrashItems: (items: IFile[]) => void; onExternalImportComplete: (destDir: string, count: number) => void; showToast: (msg: string, type: 'info' | 'error' | 'success') => void; }`
  - `export function useAppDragDrop(options: UseAppDragDropOptions): { isDragging: boolean; activeDropTarget: ResolvedDropTarget | null; startOutboundDrag: (items: IFile[], sourceDir: string) => Promise<void>; }`

- [ ] **Step 1: Write failing tests in `src/hooks/__tests__/useAppDragDrop.test.ts`**

Using the minimal DOM + React `createRoot` pattern (like `src/hooks/__tests__/useDirWatch.test.ts`), stub `document.elementFromPoint` and `api.{startNativeDrag, onDragDrop, onNativeDragEnd, exists, copyFile}` to test:
1. **Review Focus #2 (early mouse release / rejected native drag):** When `startNativeDrag` resolves `false` or rejects, `isDragging` returns to `false` immediately and subsequent `onDragDrop` treats nothing as an internal session.
2. **Review Focus #3 (drag leaving window to external app + native drag end):** `onDragDrop({ type: 'leave' })` clears `activeDropTarget` and cancels timers while keeping internal session alive; `onNativeDragEnd()` then clears `isDragging` and internal session.
3. **Spring-loaded inactive tab switching (`550ms`):** `onDragDrop({ type: 'over' })` over an inactive directory tab fires `onSelectTab(tabId)` after ~550ms, cancelled if pointer moves away or leaves early; never fires for active tab or `app://dashboard`.
4. **Internal drop execution:**
   - Drop on `{ kind: 'folder' }` or `{ kind: 'tab' }` filters via `filterActionablePathsForDir` and calls `transferFiles(actionableItems, 'cut', target.path)`.
   - Drop on `{ kind: 'trash' }` calls `onTrashItems(session.items)`.
5. **External drop execution:**
   - External `drop` (no internal session) onto a folder/tab calls `processInboundDrop` into `target.path` and calls `onExternalImportComplete(target.path, count)` + success toast.
   - External `drop` onto `Trash` does nothing (`target` resolves to `null`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/hooks/__tests__/useAppDragDrop.test.ts`
Expected: FAIL (`Cannot find module '../useAppDragDrop'`).

- [ ] **Step 3: Implement `src/hooks/useAppDragDrop.ts`**

Implement `useAppDragDrop` cleanly with:
- Refs for `internalSessionRef`, `lastInboundPathsRef`, `springLoadRef` (timer + `tabId`), `autoScrollRafRef`, `safetyTimerRef` (15s fallback cleanup if GTK `drag-end` were ever missed), and latest `optionsRef`.
- Single `useEffect` subscribing to `api.onDragDrop` and `api.onNativeDragEnd` with full cleanup on unmount.
- `startOutboundDrag(items, sourceDir)`: no-op if `items.length === 0`; sets `internalSessionRef` and `isDragging = true`, arms 15s fallback timer, awaits `api.startNativeDrag(...)`, and clears state immediately if `!started` or on error.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/hooks/__tests__/useAppDragDrop.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAppDragDrop.ts src/hooks/__tests__/useAppDragDrop.test.ts
git commit -m "feat(dnd): add useAppDragDrop app-level coordinator hook"
```

---

### Task 6: Outbound Drag Trigger, Click Suppression & Drop Target Markup in `FileList`, `Sidebar`, and `TabBar`

**Files:**
- Modify: `src/components/FileList.tsx:42-242,450-480,690-752,773-880`
- Modify: `src/components/Sidebar.tsx:22-56,115-193`
- Modify: `src/components/TabBar.tsx:13-40,111-190`
- Modify: `src/components/__tests__/FileListMedia.test.tsx`
- Create: `src/components/__tests__/DragDropTargets.test.tsx`

**Interfaces:**
- Consumes: `ResolvedDropTarget`, `collectOutboundDragItems` (`src/utils/dropTargetUtils.ts`), `normalizePath` (`src/utils/navigationHistory.ts`).
- Produces:
  - Exported pure helper `shouldSuppressClickAfterDrag(suppressedUntilMs: number, nowMs: number): boolean` in `src/components/FileList.tsx`.
  - `FileList` optional props: `activeDropTarget?: ResolvedDropTarget | null`, `onStartOutboundDrag?: (items: IFile[]) => void`.
  - `Sidebar` optional props: `activeDropTarget?: ResolvedDropTarget | null`.
  - `TabBar` optional props: `activeDropTarget?: ResolvedDropTarget | null`.

- [ ] **Step 1: Write failing tests in `FileListMedia.test.tsx` and `DragDropTargets.test.tsx`**

- In `src/components/__tests__/FileListMedia.test.tsx`:
  - Assert `shouldSuppressClickAfterDrag(1000, 950) === true` and `shouldSuppressClickAfterDrag(1000, 1050) === false` (pinning **Review Focus #4**).
- Create `src/components/__tests__/DragDropTargets.test.tsx` (using `renderToStaticMarkup`):
  - `FileList` (both `list` and `grid` modes): renders `data-drop-folder-path="/home/u/docs"` and `data-drop-scroll-container="true"` when `!isTrash`; omits `data-drop-folder-path` on regular files and when `isTrash={true}`; renders `data-drop-active="true"` and `ring-2 ring-inset ring-m3-primary` without changing `h-14` / row height when `activeDropTarget` matches.
  - `Sidebar`: renders `data-drop-sidebar="true"`, `data-drop-scroll-container="true"` on the ScrollArea viewport, `data-drop-trash="true"` on Trash, and `data-drop-active="true"` when `activeDropTarget` matches Trash or a Place/Device path.
  - `TabBar`: renders `data-drop-tab-id={tab.id}` on tab buttons and `data-drop-active="true"` when `activeDropTarget` matches `{ kind: 'tab', tabId }` or `{ kind: 'trash' }` on an `app://trash` tab.

- [ ] **Step 2: Run component tests to verify they fail**

Run: `bun test src/components/__tests__/FileListMedia.test.tsx src/components/__tests__/DragDropTargets.test.tsx`
Expected: FAIL (`shouldSuppressClickAfterDrag` undefined / `data-drop-*` attributes missing).

- [ ] **Step 3: Update `FileList.tsx`, `Sidebar.tsx`, and `TabBar.tsx`**

- **`FileList.tsx`:**
  - Export `shouldSuppressClickAfterDrag(suppressedUntilMs: number, nowMs: number): boolean`.
  - In `handleItemDragStart(e, file)`: call `e.preventDefault()`; if `isTrash` return; set `suppressClickUntilRef.current = Date.now() + 350` (reset to `0` on each fresh `onPointerDown` before any new drag starts, and consumed in `handleItemClick` when `shouldSuppressClickAfterDrag(suppressClickUntilRef.current, Date.now())` is `true` so releasing/cancelling a drag never triggers single-click navigation); compute `dragItems = collectOutboundDragItems(file, currentFiles, currentSelected)`; if `!currentSelected.has(file.path)` call `select(file, false, false)`; call `onStartOutboundDrag?.(dragItems)`.
  - On directory `FileListRow` and Grid folder cards (`!isTrash && file.isDirectory`), attach `data-drop-folder-path={file.path}`, `data-drop-active={isDropTarget ? 'true' : undefined}`, and `ring-2 ring-inset ring-m3-primary bg-m3-primary-container/35` when active; attach `data-drop-scroll-container="true"` to `activeScrollRef` in both List and Grid views.
- **`Sidebar.tsx`:**
  - Wrap drawer content in `[data-drop-sidebar="true"]`, pass `viewportProps={{ 'data-drop-scroll-container': 'true' } as React.HTMLAttributes<HTMLDivElement>}` to `ScrollArea`, wrap `NavigationDrawerItem`s in `<div data-drop-folder-path={...} data-drop-active={...}>` (and `data-drop-trash="true"` for Trash) applying `ring-2 ring-inset ring-m3-primary bg-m3-primary-container/35` to `NavigationDrawerItem`'s `className` when active.
- **`TabBar.tsx`:**
  - Add `data-drop-tab-id={tab.id}` and `data-drop-active={isDropActive ? 'true' : undefined}` to tab `Button`s, applying `ring-2 ring-inset ring-m3-primary bg-m3-primary-container/35` when `activeDropTarget` matches the tab (or Trash when `tab.path === 'app://trash'`).

- [ ] **Step 4: Run component tests and typecheck**

Run: `bun test src/components/__tests__/FileListMedia.test.tsx src/components/__tests__/DragDropTargets.test.tsx && bunx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FileList.tsx src/components/Sidebar.tsx src/components/TabBar.tsx src/components/__tests__/FileListMedia.test.tsx src/components/__tests__/DragDropTargets.test.tsx
git commit -m "feat(ui): wire native outbound drag trigger and drop target markup in FileList, Sidebar, and TabBar"
```

---

### Task 7: Wire Coordinator & Search/Tab Refresh in `ExplorerTab.tsx` and `App.tsx` + Full Verification

**Files:**
- Modify: `src/utils/explorerTabUtils.ts`
- Modify: `src/components/ExplorerTab.tsx:64-136,429-539,1102-1155`
- Modify: `src/App.tsx:257-362,801-862`
- Modify: `src/components/__tests__/ExplorerTabSilentReload.test.ts`

**Interfaces:**
- Consumes: `useAppDragDrop`, `usePaste.transferFiles`, `FileList`/`Sidebar`/`TabBar` updated props.
- Produces:
  - `export interface TransferSyncSignal { id: number; affectedDirs: string[]; removedPaths: string[]; refreshTrash?: boolean; }`
  - `export function pruneRemovedFilePaths<T extends { path: string }>(files: T[], removedPaths: ReadonlySet<string>): T[]` in `src/utils/explorerTabUtils.ts`
  - `export function shouldSilentlyRefreshTab(tabPath: string, searchActive: boolean, affectedDirs: ReadonlySet<string>, refreshTrash?: boolean): boolean` in `src/utils/explorerTabUtils.ts`

- [ ] **Step 1: Write failing tests in `ExplorerTabSilentReload.test.ts`**

Add tests covering:
- `pruneRemovedFilePaths`: removes only paths in `removedPaths` (leaving skipped/cancelled items intact, pinning **Review Focus #5**) and returns the same array reference if nothing matched.
- `shouldSilentlyRefreshTab`: returns `true` for normal tabs whose `normalizePath(tabPath)` is in `affectedDirs`, `true` for `app://trash` when `refreshTrash === true`, and `false` when `searchActive === true` or `tabPath === 'app://dashboard'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/components/__tests__/ExplorerTabSilentReload.test.ts`
Expected: FAIL (`pruneRemovedFilePaths` / `shouldSilentlyRefreshTab` not defined).

- [ ] **Step 3: Implement helpers in `explorerTabUtils.ts` and wire `ExplorerTab.tsx` + `App.tsx`**

1. In `src/utils/explorerTabUtils.ts`: add `pruneRemovedFilePaths` and `shouldSilentlyRefreshTab`.
2. In `src/components/ExplorerTab.tsx`:
   - Add optional props: `isDragging?: boolean`, `activeDropTarget?: ResolvedDropTarget | null`, `onStartOutboundDrag?: (items: IFile[], sourceDir: string) => void`, `transferSyncSignal?: TransferSyncSignal | null`.
   - Remove the tab-local `api.onDragDrop` `useEffect`, `markDragStarted`, `clearDrag`, `dragTimeoutRef`, `onDragStartCapture`/`onDragStart`/`onDragEnd` on the wrapper, and `window` `pointerup`/`mouseup`/`dragend`/`drop`/`focus` drag listeners.
   - Sync `isDraggingRef.current = Boolean(isDragging)` and when `isDragging` transitions `true -> false` with `pendingReloadAfterDragRef.current === true`, clear the flag and call `reloadSilently()`.
   - React to `transferSyncSignal`: if `searchActiveRef.current` and `transferSyncSignal.removedPaths.length > 0`, prune `files` via `pruneRemovedFilePaths` and `selectedFiles` via `pruneSelectedFiles` without clearing `searchActive`; else if `shouldSilentlyRefreshTab(currentPathRef.current, searchActiveRef.current, affectedSet, transferSyncSignal.refreshTrash)`, call `reloadSilently()`.
   - Attach `data-drop-explorer-root="true"`, `data-explorer-path={currentPath}`, `data-search-active={searchActive ? 'true' : 'false'}` and `ring-2 ring-inset ring-m3-primary/60` when `activeDropTarget?.kind === 'folder' && activeDropTarget.source === 'explorer-root' && normalizePath(activeDropTarget.path) === normalizePath(currentPath)` to the Explorer content wrapper.
   - Pass `activeDropTarget` and `onStartOutboundDrag={(items) => onStartOutboundDrag?.(items, currentPathRef.current)}` to `<FileList>`.
3. In `src/App.tsx`:
   - Track `transferSyncSignal` state (`useState<TransferSyncSignal | null>(null)`), bumping `id` from:
     - `usePaste`'s `onTransferComplete` (`{ affectedDirs, removedPaths: operation === 'cut' ? completedSourcePaths : [] }`),
     - `onExternalImportComplete(destDir)` (`{ affectedDirs: [normalizePath(destDir)], removedPaths: [] }`),
     - `executeTrashItems` (collect parent dirs of trashed items as `affectedDirs`, `removedPaths: items.map(i => i.path)`, `refreshTrash: true`).
   - Instantiate `useAppDragDrop({ tabs, activeTabId, onSelectTab: handleSelectTab, transferFiles, onTrashItems: handleTrashRequest, onExternalImportComplete, showToast })`.
   - Pass `activeDropTarget` to `<Sidebar>`, `<TabBar>`, and each `<ExplorerTab>`; pass `isDragging`, `startOutboundDrag`, and `transferSyncSignal` to `<ExplorerTab>`.

- [ ] **Step 4: Run full automated verification suite**

Run:
```bash
bun test && bunx tsc -b && bun run lint && bun run build && cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```
Expected: ALL pass with zero errors and zero warnings.

- [ ] **Step 5: Interactive Hyprland End-to-End Verification Checklist**

Launch `bun run tauri:dev` on Hyprland/Wayland and manually verify:
1. Drag single image, folder, and multi-selection from List and Grid views onto **`photos0x`**: all 3 drop zones activate on hover and dropping enqueues files/folder contents cleanly.
2. Drag file onto a browser file input / chat window (attaches file) and onto a terminal window (pastes path via `text/plain`).
3. Drag item onto a `FileList` subfolder, onto `Sidebar` (`Places`, `Devices`, and `Trash`), and onto `TabBar` (immediate drop + 550ms hover-to-switch spring-load), confirming `ClipboardContext` (`Ctrl+C`/`Ctrl+V`) remains intact and active search tabs prune moved items without losing query.
4. Drag file from an external app onto a subfolder, Sidebar item, Tab, and open folder background to verify non-colliding copy.

- [ ] **Step 6: Commit**

```bash
git add src/utils/explorerTabUtils.ts src/components/ExplorerTab.tsx src/App.tsx src/components/__tests__/ExplorerTabSilentReload.test.ts
git commit -m "feat(dnd): integrate app drag-drop coordinator, directory refresh, and search pruning"
```
