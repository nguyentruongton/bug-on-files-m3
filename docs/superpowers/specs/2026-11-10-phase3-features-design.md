# Phase 3 – Feature Additions (Short Design)

## Intent & Why
User runs Arch Linux + Caelestia shell and wants a file explorer that feels like Finder / Windows Explorer. Phase 3 closes the remaining gaps vs. those apps. Dual-pane split view was **dropped** (neither Finder nor Explorer has it; tabs suffice).

## Goals
1. Paste conflict resolution (no silent overwrite).
2. Live directory refresh when contents change externally.
3. Quick Look preview with `Space`.

## Non-goals / Anti-goals
- No dual-pane, no recursive watching, no external previewers (sushi, sioyek).
- Anti-goal: any path where paste can destroy data without asking.
- Anti-goal: refresh that wipes selection or interrupts rename/drag.

## Constraints
- Electron 39 + React 19, IPC via `electron/preload.ts`; reuse existing `media://` protocol and `fs:read-file`.
- Material 3 styling consistent with existing Dialog/Toast components.
- Order of work: 1 → 2 → 3, each independently shippable.

## Approaches (chosen by user: "OK theo đề xuất")
- **Paste conflicts:** single sensible way — check destination existence, show dialog. (Rejected: auto-rename always; overwrite always.)
- **Live refresh:** (A) Node `fs.watch`, non-recursive, debounced — **chosen**; (B) `chokidar` — rejected, extra dependency for a small need.
- **Quick Look:** (A) in-app overlay via `media://` — **chosen**; (B) external `sushi`/`sioyek` — rejected, extra install, not themed; (C) A + syntax highlighting — deferred.

## Design
### 1. Paste conflict dialog
- Before each copy/move, check `exists(dest)`.
- If it exists: M3 dialog with **Replace / Skip / Keep both**, plus "Apply to all remaining" checkbox when pasting multiple items. Cancel aborts the rest.
- Keep both → `name (2).ext`, `(3)`… first free name.
- Copy into the same folder as source: skip the prompt and create the "(2)" copy directly.
- Applies to Ctrl+V and context-menu paste (share one paste routine, extracted from `ExplorerTab`).
- Replace never merges directories. It moves the existing target to trash first, then copies/moves (my call: recoverable).

### 2. Live refresh
- Main process: `fs:watch-start(dir)` / `fs:watch-stop(id)`; emits `fs:changed:<id>` events. One watcher per visible tab's current directory.
- Debounce ~150ms in main. Renderer reloads listing silently (no skeleton) and keeps selection for paths that still exist.
- Stop on path change, tab close, dashboard view, and cleanup on window close.
- Suppress refresh while rename/drag is active.
- Watcher errors (dir deleted, permissions) → fall back to normal navigation to parent / toast; never crash.

### 3. Quick Look
- `Space` with selection (not while typing in inputs/terminal) toggles an overlay; `Esc` or `Space` closes; ←/→ (↑/↓ in list) move to prev/next file in current sorted list.
- Types: images, video, audio via `media://`; PDF via Chromium viewer; text/code via `fs:read-file`, plain text, size cap (builder's call: ~1 MB, show "too large" notice beyond). Other types: icon + name, size, modified date, "Open" button.
- Folders: show name, item count/size info; no preview body.

## Left to the builder
Component/file layout, exact dialog copy, debounce tuning, size cap, tests (extend `electron/__tests__` and `src/utils/__tests__`).
