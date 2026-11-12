# Migration to Tauri + @bug-on/m3-expressive UI — Design

Date: 2026-11-12 · Status: awaiting approval

## Intent and why

"Materials" is an Electron + React file manager for Linux. The owner wants it to **start faster and use less RAM and fewer system resources**. Electron bundles Chromium (110 MB AppImage), which is the main cost. The plan is to move to **Tauri** (Rust backend + system WebKitGTK) and rebuild the UI with the **`@bug-on/m3-expressive`** React library (Material 3 Expressive; React 19, Tailwind v4, `motion`).

## Goals

- Measurably faster cold start and lower idle/working RAM than the current Electron build, on Linux.
- Feature parity with the current app (the ~35 IPC commands listed below).
- UI rebuilt on `@bug-on/m3-expressive`, using its theming (`MD3ThemeProvider`) and components.
- Much smaller package (target: single-digit to low tens of MB; exact target is the builder's call after the spike).

## Non-goals

- Windows/macOS support (Linux only, as today).
- Replacing the UI with a native Rust toolkit (GTK4/Slint/Iced) — rejected, see Approaches.
- New features beyond parity during the migration.

## Anti-goals (failure even if it "works")

- Animations visibly janky on WebKitGTK compared with Electron.
- RAM/startup not measurably better than Electron (then the migration has no point).
- Losing existing features (terminal, watchers, open-with, search, preview). Drag-out is deferred (see Decisions).

## Current state

- `electron/` ≈ 920 lines TS: `main.ts` (IPC handlers, `media://` protocol, window), `dirWatcher.ts`, `pty.ts` (node-pty), `systemUtils.ts`, `textPreview.ts`, `preload.ts`; 3 test files.
- `src/` ≈ 5.5k lines TSX/CSS, plain CSS (no Tailwind), custom `ThemeService`, `xterm` terminal.
- The renderer talks to the backend only through `window.electron` (35 methods; `preload.ts`):
  - FS: `listDir, getParentPath, getHomePath, getPlaces, copyFile, moveFile, trashFile, renameFile, createDirectory, openPath, extractFile, exists, readFile, readTextPreview, getDirectorySize, search, watchStart/watchStop/onWatchEvent`
  - System: `getApps, openWith, getRecommendedApps, getDrives, getStorageUsage, getStartupPath, getThemeCss, setIcon`
  - Dialogs: `openFileDialog, openDirectoryDialog`
  - Native drag-out: `startDrag`
  - PTY: `ptySpawn, ptyWrite, ptyResize, ptyKill, ptyOnData, ptyOnExit`
  - `media://` custom protocol serves local files for previews.
- Dev machine has no Rust toolchain yet.

## Constraints

- Linux, WebKitGTK is the renderer in Tauri. Requires `rustup` and system packages (`webkit2gtk-4.1`, GTK3 dev libs, etc.) installed by the owner.
- The library supports Tailwind v4 only → Tailwind must be added to the project.
- Library is young and from a single author: version-pin it and expect to patch around gaps.

## Approaches considered

- **A. Two stages** (rebuild UI on Electron, then move to Tauri): each step is verifiable, but needs a throwaway Electron compatibility layer and the first stage gives no RAM/startup gain. Rejected.
- **B. Tauri from the start, UI and backend in parallel, de-risked by a spike** — **chosen by the owner.** Fastest to learn whether WebKitGTK handles the library's animations.
- **C. Tauri with the old UI, backend only**: quickest resource win but does not deliver the UI rewrite. Rejected.
- Native Rust GUI: cannot use the library at all, and needs a hand-built M3 look. Rejected.

## Design (Approach B)

1. **Spike (gate).** Minimal Tauri app + the library: one file-list screen with realistic folder size (e.g. 5k entries), a dialog, and a shape/spring animation. Compare against the current Electron build on cold start time, idle RAM (including child processes), and animation smoothness. **Go/no-go checkpoint with the owner** before continuing. If WebKitGTK animations are unacceptable, stop and revisit (options: reduce animations, or other approaches).
2. **Backend API seam.** Rename `window.electron` to a typed `api` module in `src/` (one place wrapping `invoke`/events). The UI never calls Tauri directly.
3. **Backend in Rust** as `#[tauri::command]`s, one per current IPC method, mapping suggestion: `notify` (watch), `portable-pty` (terminal), `trash` (trash), `walkdir` (search/size), `tauri-plugin-dialog`, `tauri-plugin-opener` or `xdg-open`/desktop-entry parsing for open-with and apps. `media://` becomes a Tauri custom/asset protocol. Events (watch, pty data/exit) use Tauri events or channels.
4. **UI rewrite** screen by screen on `@bug-on/m3-expressive`, Tailwind v4, `motion`; replace `ThemeService` with the library's theming where possible. Can proceed in parallel with step 3 against the api seam.
5. **Packaging** with Tauri bundler for Linux (AppImage and/or deb; keep `PKGBUILD`/`install.sh` working or updated). Remove Electron, `node-pty`, `electron-builder` at the end.
6. **Cutover** once parity is reached and the metrics from step 1 still hold on the full app.

## Known risks

- **WebKitGTK animation/CSS performance** (gate above).
- **Native drag-out of files** (`startDrag`) has no first-class Tauri equivalent; may need a plugin/GTK-level code. Fallback: drop the feature or provide an alternative (e.g. copy-to-clipboard) — owner decision if the spike shows it is hard.
- Library maturity (single maintainer, new).
- Terminal throughput through Tauri IPC (xterm.js stays as the front end).

## Left to the builder

Crate choices, command signatures, file/module layout, Tailwind setup details, how to measure metrics, test strategy (existing Electron-side tests need to be ported to Rust), screen order for the UI rewrite, CI/packaging details, and how to handle drag-out within the fallback above.

## Decisions from the owner

- **Gate thresholds:** idle RAM (all processes) at least 40% lower than Electron; time to first file list at least 30% faster; animation smoothness judged by the owner by hand (no fps threshold). The owner makes the go/no-go call.
- **Drag-out is deferred** to after cutover; it is not in the spike and does not block cutover.

## Builder's calls (made by the designer, owner may override)

- Rust backend and the `api` seam proceed in parallel with the spike; the UI rewrite starts only after the gate passes.
- Primary target: Arch Linux (`PKGBUILD`) with `webkit2gtk-4.1`; measure on Wayland and X11. `.deb`/AppImage come later.
- Parity = features, not pixel layout. The library's theming replaces `ThemeService`; keep system colour integration only if cheap.
- Missing components (virtualized list, context menu, etc.) are built in M3 style in-repo; do not fork the library.
- Backend has full filesystem access like Electron today; `media://` becomes a custom protocol with range request support; existing tests are ported to Rust.
