# Tauri Migration (Spike, API Seam, Rust Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Tauri + `@bug-on/m3-expressive` beats Electron on startup and RAM (the gate), while building the typed `api` seam and the full Rust backend in parallel.

**Architecture:** `src-tauri/` holds a Tauri 2 app whose Rust commands mirror today's 35 `window.electron` methods. The renderer talks only to `src/api` (one typed object with an Electron adapter and a Tauri adapter), so the current UI keeps working on Electron until cutover. Pure logic lives in small Rust modules with `cargo test`; commands are thin wrappers.

**Tech Stack:** Tauri 2, Rust (crates: `notify`, `portable-pty`, `trash`, `walkdir`, `serde`, `tauri-plugin-dialog`, `tauri-plugin-opener`), React 19, Vite 7, Tailwind v4, `@bug-on/m3-expressive`, `motion`, `bun:test` for TS tests.

**Spec:** `docs/superpowers/specs/2026-11-12-tauri-m3-expressive-migration-design.md`

**Out of scope here (separate plan after the gate passes):** the screen-by-screen UI rewrite, packaging (PKGBUILD/install.sh/bundles), removing Electron, drag-out (deferred by owner).

## Global Constraints

- Linux only; primary target Arch with `webkit2gtk-4.1`; measure on Wayland and X11.
- Gate thresholds (owner): idle RAM (all processes) at least 40% lower than Electron; time to first file list at least 30% faster; animation smoothness judged by the owner by hand, no fps threshold. The owner makes the go/no-go call.
- Rust backend has full filesystem access like Electron today (no path allow-list).
- `media://` becomes a custom protocol with range-request support.
- Existing logic tests in `electron/__tests__` are ported to Rust, not dropped.
- UI rewrite starts only after the gate passes; backend and `api` seam run in parallel with the spike.
- Missing library components are built in-repo in M3 style; do not fork the library.
- Pin `@bug-on/m3-expressive` to an exact version (no `^`).
- Event names stay as today: `fs:watch-event`, `terminal:data:{pid}`, `terminal:exit:{pid}`.

## Review Focus

- Filenames with spaces, unicode, leading dots, and non-UTF-8 bytes: listed, renamed, and opened without panic (non-UTF-8 shown lossy).
- Broken symlinks and unreadable entries inside a directory: skipped, the rest of the listing still returns (matches Electron's skip-on-stat-failure).
- `search` query containing glob characters (`*`, `?`, `[`): treated literally, not as a pattern.
- `copy` onto an existing destination: existing files are kept (Electron `force: false`), never silently overwritten.
- Watched directory deleted or permission lost: emits one `error` event, does not crash the app; `watch_stop` on an unknown id is a no-op.
- Terminal: shell exits on its own (`exit`), then `terminal:exit:{pid}` fires once and later `pty_write` to that pid does not panic.

(Each line has its pinning test in the owning task below.)

---

### Task 1: Tauri scaffold

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/icons/` (from `assets/icon.png`)
- Modify: `package.json` (add `@tauri-apps/api`, `@tauri-apps/cli`, scripts `tauri:dev`, `tauri:build`), `.gitignore` (`src-tauri/target`)

**Interfaces:**
- Produces: crate `materials` (lib name `materials_lib`) with `pub fn run()` in `lib.rs`; `tauri.conf.json` identifier `com.material3.filemanager`, productName `Materials`, `build.devUrl` `http://localhost:5173`, `build.frontendDist` `../dist`, `beforeDevCommand` `bun run dev`, `beforeBuildCommand` `bun run build:web` (add script `build:web` = `tsc -b && vite build`).

- [ ] **Step 1: Verify prerequisites** (owner installs if missing): `rustc --version` (≥1.77), `pkg-config --modversion webkit2gtk-4.1`. Expected: both print versions. If not, stop and ask the owner to install `rustup` and `webkit2gtk-4.1`, `gtk3`, `libsoup3`, `librsvg` (Arch package names).
- [ ] **Step 2: Create the scaffold** by hand (not `tauri init`, to control paths); window 1100×720, title `Materials`, `decorations` true. `run()` builds the default app with no commands yet.
- [ ] **Step 3: Verify** `cd src-tauri && cargo build` → exits 0; `bun run tauri:dev` → a window opens showing the existing Vite UI (its Electron calls failing in the console is expected until Task 5/14).
- [ ] **Step 4: Commit** `git add src-tauri package.json bun.lock .gitignore && git commit -m "feat: scaffold Tauri 2 app"`

### Task 2: Spike page with the M3 library

**Files:**
- Create: `spike.html`, `src/spike/main.tsx`, `src/spike/SpikeApp.tsx`, `src/spike/spike.css`
- Modify: `package.json` (add `tailwindcss`, `@tailwindcss/vite`, `@bug-on/m3-expressive`, `motion`), `vite.config.ts` (add `@tailwindcss/vite` plugin; `build.rollupOptions.input` with both `index.html` and `spike.html`)

**Interfaces:**
- Produces: `spike.html` served by Vite; `SpikeApp` renders (a) a list of 5,000 generated rows (`name`, `size`, `mtime`) virtualized with the already-installed `react-window`, (b) one library button opening a library dialog, (c) one animated shape/spring element from the library, (d) a ready ping: after the first list commit, `fetch(new URLSearchParams(location.search).get('ping') ?? '')` is called once if the `ping` query param is set.
- Tauri loads it with `?ping=http://127.0.0.1:8787/ready`.

- [ ] **Step 1: Install and read the library docs** (`https://m3.bugon.io.vn`) for the exact component and export names; `spike.css` imports `tailwindcss`, `@bug-on/m3-expressive/index.css`. Wrap the app in `MD3ThemeProvider`.
- [ ] **Step 2: Implement `SpikeApp`** per the Interfaces above using real library components for button, dialog, and the animated element.
- [ ] **Step 3: Verify** `bun run dev` then open `http://localhost:5173/spike.html` in a browser: list scrolls, dialog opens, animation runs, no console errors. Then `bun run build:web` → exits 0 and `dist/spike.html` exists.
- [ ] **Step 4: Commit** `git commit -m "feat: add M3 Expressive spike page"`

### Task 3: Benchmark harness and gate report

**Files:**
- Create: `scripts/bench/ping-server.ts`, `scripts/bench/measure.sh`, `scripts/bench/electron-harness.cjs`, `docs/superpowers/specs/2026-11-12-spike-results.md`

**Interfaces:**
- Consumes: `dist/spike.html` (Task 2), Tauri build from Task 1.
- Produces: `scripts/bench/measure.sh <tauri|electron|electron-app>` printing `startup_ms=<n> idle_rss_mb=<n>`; run 5 times per target, report the median.
  - `startup_ms`: time from process spawn to the page's ping, received by `ping-server.ts` (listens on `127.0.0.1:8787`, prints the elapsed ms from a start timestamp passed via env `BENCH_T0_MS`).
  - `idle_rss_mb`: 10 s after the ping, sum of `VmRSS` (`/proc/<pid>/status`) over the launched process and all descendants.
  - `electron` target: `electron-harness.cjs` is a minimal Electron main that loads `dist/spike.html?ping=…` (same page as Tauri → apples to apples).
  - `electron-app` target: the real current app, RSS only (no ping available), as a reference number.
  - `tauri` target: the debug-free build `src-tauri/target/release/materials` started with `?ping` via env var `MATERIALS_SPIKE_URL` read in `lib.rs` (add a 5-line env override of the initial URL, spike-only).

- [ ] **Step 1: Write `ping-server.ts` and `measure.sh`**; verify with the `electron` target first: `bash scripts/bench/measure.sh electron` → prints both numbers.
- [ ] **Step 2: Build release** `bun run tauri:build -- --no-bundle` then `bash scripts/bench/measure.sh tauri` → prints both numbers. Repeat on Wayland and X11 (`GDK_BACKEND=x11` for the X11 run).
- [ ] **Step 3: Write `2026-11-12-spike-results.md`** with a table (target × session type: startup median, RSS median), percent differences against the thresholds above, and a short note on how animation looked in each (fill in after the owner tries `bun run tauri:dev` on the spike page).
- [ ] **Step 4: Commit** `git commit -m "docs: spike benchmark results"`
- [ ] **Step 5: GATE — stop.** Present the results to the owner and ask go/no-go. Tasks 4 onward are independent of the gate and may proceed; the UI rewrite plan is written only after "go".

### Task 4: Shared types and the `api` contract

**Files:**
- Create: `src/api/types.ts`
- Delete: `src/types/electron.d.ts` (contents move)
- Modify: `src/types/files.ts`

**Interfaces:**
- Produces: in `src/api/types.ts`, `export interface IApi` = today's `IElectronAPI` (every method name and signature unchanged), plus exported `WatchEvent`, `TextPreview`, `IDrive` (moved verbatim). `IFile` stays in `src/types/files.ts` with `mtime: Date`.
- The `declare global { interface Window { electron: IApi } }` stays in `src/api/electronAdapter.ts` (Task 5).

- [ ] **Step 1: Move the types** as above; run `bunx tsc -b` → still passes (imports updated).
- [ ] **Step 2: Commit** `git commit -m "refactor: move API types to src/api"`

### Task 5: Adapters and call-site migration

**Files:**
- Create: `src/api/electronAdapter.ts`, `src/api/tauriAdapter.ts`, `src/api/index.ts`, `src/api/__tests__/tauriAdapter.test.ts`, `src/api/commandMap.ts`
- Modify: every file that uses `window.electron` — `src/services/ThemeService.ts`, `src/services/FileSystemService.ts`, `src/components/{OpenWithDialog,TerminalPane,ExplorerTab,PropertiesDialog,Sidebar,Dashboard,FileList,QuickLook}.tsx`, `src/hooks/{useDirWatch,usePaste}.ts(x)`, `src/App.tsx`, `src/hooks/__tests__/useDirWatch.test.ts` (replace `window.electron` with `api`)

**Interfaces:**
- Produces:
  - `export const api: IApi` in `src/api/index.ts` (selects Tauri if `'__TAURI_INTERNALS__' in window`, else Electron).
  - `export function createTauriAdapter(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>, listen: (event: string, cb: (payload: unknown) => void) => Promise<() => void>): IApi` in `src/api/tauriAdapter.ts`.
  - `export const COMMAND_MAP: Record<Exclude<keyof IApi, 'startDrag' | 'onWatchEvent' | 'ptyOnData' | 'ptyOnExit'>, string>` in `commandMap.ts`: IApi method → Rust command name in `snake_case` (e.g. `listDir: 'list_dir'`, `ptySpawn: 'pty_spawn'`).
  - Rust returns `mtime_ms`; the adapter's `listDir` and `search` map each entry to `IFile` with `mtime: new Date(mtimeMs)`.
  - `startDrag` in the Tauri adapter is a no-op (deferred).
  - Event methods return an unsubscribe function synchronously (wrap the `listen` promise).

- [ ] **Step 1: Write failing tests** in `tauriAdapter.test.ts` with a fake `invoke`/`listen`:
  - `listDir calls list_dir with { path } and converts mtimeMs to Date`
  - `copyFile calls copy_file with { source, dest }`
  - `onWatchEvent unsubscribes even if called before listen resolves`
  - `ptyOnData subscribes to terminal:data:7 for pid 7`
  - `every COMMAND_MAP key exists on the adapter`
- [ ] **Step 2: Run** `bun test src/api` → FAIL (modules missing).
- [ ] **Step 3: Implement** `createTauriAdapter` (arg names are the camelCase parameter names from `IApi`; Rust side uses `#[tauri::command(rename_all = "camelCase")]`), `electronAdapter` (returns `window.electron`), and `index.ts`.
- [ ] **Step 4: Run** `bun test src/api` → PASS.
- [ ] **Step 5: Migrate call sites** from `window.electron.x` to `api.x`. Verify `bunx tsc -b` → exits 0, `bun test` → all existing tests pass, `bun run electron:dev` → app still works on Electron.
- [ ] **Step 6: Commit** `git commit -m "refactor: route renderer through api seam"`

### Task 6: Filesystem commands

**Files:**
- Create: `src-tauri/src/fs_ops.rs`, `src-tauri/src/commands/fs.rs`, `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/Cargo.toml` (`trash`, `serde`, `serde_json`, `dirs`, `tempfile` dev), `src-tauri/src/lib.rs` (register commands)

**Interfaces:**
- Produces in `fs_ops.rs` (pure, tested):
  - `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct FileEntry { name: String, path: String, is_directory: bool, size: u64, mtime_ms: u64 }`
  - `pub fn list_dir(path: &str) -> Result<Vec<FileEntry>, String>` (empty path → home; entries whose `metadata` fails are skipped; follows symlinks like `fs.stat`)
  - `pub fn copy_path(source: &str, dest: &str) -> Result<(), String>` (recursive; existing destination files are kept)
  - `pub fn move_path(source: &str, dest: &str) -> Result<(), String>` (rename; on cross-device error, copy then delete)
  - `pub fn rename_path`, `pub fn make_dir(path) ` (recursive), `pub fn exists(path) -> bool`, `pub fn parent_of(path) -> String`, `pub fn read_file_text(path) -> Option<String>` (port `main.ts:326-333`)
- Commands (each `Result<T, String>`): `list_dir, get_parent, get_home, copy_file, move_file, trash_file, rename_file, create_directory, exists, read_file` using `COMMAND_MAP` names.

- [ ] **Step 1: Write failing tests** in `fs_ops.rs` (`#[cfg(test)]`, `tempfile`): `list_dir_skips_broken_symlink`, `list_dir_handles_spaces_and_unicode_names`, `list_dir_empty_path_uses_home`, `copy_path_recurses_directories`, `copy_path_keeps_existing_destination_files`, `move_path_renames_file`, `make_dir_is_recursive`, `parent_of_root_is_root`.
- [ ] **Step 2: Run** `cd src-tauri && cargo test fs_ops` → FAIL.
- [ ] **Step 3: Implement** the functions above; command wrappers are one-liners (`trash_file` uses the `trash` crate directly).
- [ ] **Step 4: Run** `cargo test fs_ops` → PASS; `cargo build` → 0.
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): filesystem commands"`

### Task 7: Places and text preview

**Files:**
- Create: `src-tauri/src/places.rs`, `src-tauri/src/text_preview.rs`
- Modify: `src-tauri/src/commands/fs.rs`

**Interfaces:**
- Produces:
  - `pub struct PlaceItem { name, path, icon }` (`Serialize`), `pub fn resolve_places(home: &str, system_path: impl Fn(PlaceKey) -> Option<String>) -> Vec<PlaceItem>`; same seven places, names and emoji icons as `PLACE_DEFINITIONS` in `electron/systemUtils.ts:90-111`; empty or equal-to-home resolutions fall back to `<home>/<Name>`; trailing slashes stripped. Command `get_places` uses the `dirs` crate for the system path.
  - `pub const TEXT_PREVIEW_MAX_BYTES: u64 = 1_048_576;` and `pub fn read_text_preview(path: &str, max_bytes: u64) -> TextPreview` with `#[serde(tag = "kind", rename_all = "kebab-case")] enum TextPreview { Text { content: String }, TooLarge { size: u64 }, Binary, Error }`. Rules identical to `electron/textPreview.ts` (null byte in first 8192 bytes ⇒ `Binary`). Command `read_text_preview`.
- [ ] **Step 1: Port the tests** from `electron/__tests__/systemUtils.test.ts` (places part) and `textPreview.test.ts` into `#[cfg(test)]` modules with the same names and assertions.
- [ ] **Step 2: Run** `cargo test places text_preview` → FAIL.
- [ ] **Step 3: Implement** both modules and commands.
- [ ] **Step 4: Run** same command → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): places and text preview"`

### Task 8: App-level commands (open, extract, dialogs, startup path, theme, icon)

**Files:**
- Create: `src-tauri/src/extract.rs`, `src-tauri/src/commands/app.rs`
- Modify: `src-tauri/Cargo.toml` (`tauri-plugin-dialog`, `tauri-plugin-opener`), `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `pub fn extract_command(file: &str) -> Option<(String, Vec<String>)>`: `.zip` → `unzip -o <file> -d <dir>`; `.tar/.gz/.xz/.tgz` → `tar -xf <file> -C <dir>`; case-insensitive; else `None` (port `electron/systemUtils.ts:17-31`).
  - Commands: `extract_file(path) -> Result<bool, String>`, `open_path(path) -> String` (empty string on success, error text otherwise), `open_file_dialog() -> Option<String>`, `open_directory_dialog() -> Option<String>`, `get_startup_path() -> Option<String>` (last CLI arg; directory → itself, file → parent, relative or missing → `None`, port `main.ts:338-362`), `get_theme_css() -> Option<String>` (reads `~/.config/matugen/theme.css`), `set_icon(icon_type: String)` (absolute path or `assets/icon-<type>.png` next to resources; missing file ignored).
- [ ] **Step 1: Port tests** for extract commands from `systemUtils.test.ts`, plus `startup_path_of_file_returns_parent`, `startup_path_relative_returns_none`.
- [ ] **Step 2: Run** `cargo test extract app` → FAIL.
- [ ] **Step 3: Implement**; extraction spawns the process and returns `true` on exit 0.
- [ ] **Step 4: Run** `cargo test` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): app commands"`

### Task 9: Desktop applications (open with)

**Files:**
- Create: `src-tauri/src/desktop_entry.rs`, `src-tauri/src/commands/apps.rs`

**Interfaces:**
- Produces:
  - `pub struct DesktopEntry { name: String, icon: Option<String>, exec: String, no_display: bool, mime_types: Vec<String>, path: Option<String> }`
  - `pub fn parse_desktop_entry(content: &str, file_path: Option<&str>) -> Option<DesktopEntry>` (only the `[Desktop Entry]` section; port `systemUtils.ts:44-83`)
  - `pub fn matches_mime(entry_mime_types: &[String], target: &str) -> bool` (port `systemUtils.ts:84-89`, includes wildcard handling as there)
  - Commands `get_apps() -> Vec<{name, icon, exec}>` (scan `/usr/share/applications`, `~/.local/share/applications`, skip `no_display`, cached in a `OnceLock`), `get_recommended_apps(path) -> Vec<{name, icon, exec, path}>` (MIME via `xdg-mime query filetype`), `open_with(exec: String, path: String) -> bool` (strip `%f %F %u %U` codes, spawn detached with the path as an argument, no shell).
- [ ] **Step 1: Port tests** from `systemUtils.test.ts` (desktop entry and mime parts), same names.
- [ ] **Step 2: Run** `cargo test desktop_entry` → FAIL.
- [ ] **Step 3: Implement** the module and commands.
- [ ] **Step 4: Run** `cargo test desktop_entry` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): desktop entries and open-with"`

### Task 10: System info and search

**Files:**
- Create: `src-tauri/src/system_info.rs`, `src-tauri/src/search.rs`, `src-tauri/src/commands/system.rs`

**Interfaces:**
- Produces:
  - `pub fn parse_lsblk(json: &str) -> Vec<Drive>` with `Drive { name, label, mountpoint, size, #[serde(rename = "type")] kind, removable, usb }` (port the filtering/mapping at `main.ts:254-304`); command `get_drives` runs `lsblk -J -o NAME,LABEL,MOUNTPOINT,SIZE,TYPE,TRAN,RM` (extend columns to whatever `main.ts` currently requests).
  - `pub fn parse_df(output: &str) -> Option<StorageUsage { total: u64, used: u64, free: u64 }>` (bytes from `df -kP /`); command `get_storage_usage`.
  - `pub fn directory_size(path: &str) -> u64` (walkdir, ignores unreadable entries); command `get_directory_size`.
  - `pub struct SearchOptions { type: Option<char> /* 'f'|'d' */, min_size: Option<String>, max_size: Option<String> }` and `pub fn search(dir: &str, query: &str, opts: &SearchOptions) -> Vec<FileEntry>`: walks with `walkdir`, case-insensitive substring match on the file name (query is literal, never a glob), size filters use `find`'s syntax (`+10M` semantics: min uses `-size +N`, max `-size -N`; reuse a `parse_find_size(&str) -> Option<u64>` helper), returns at most 100 entries. Command `search`.
- [ ] **Step 1: Write failing tests**: `parse_lsblk_marks_usb_and_removable`, `parse_df_converts_kib_to_bytes`, `search_treats_glob_chars_literally` (files `a*b.txt` and `axb.txt`; query `a*b` returns one), `search_is_case_insensitive`, `search_limits_to_100`, `search_filters_by_type_and_min_size`, `directory_size_sums_nested_files`.
- [ ] **Step 2: Run** `cargo test system_info search` → FAIL.
- [ ] **Step 3: Implement** and register commands.
- [ ] **Step 4: Run** same → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): system info and search"`

### Task 11: Directory watcher

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/Cargo.toml` (`notify`), `src-tauri/src/commands/fs.rs` (`watch_start`, `watch_stop`), `src-tauri/src/lib.rs` (manage `Watchers` state)

**Interfaces:**
- Produces:
  - `#[serde(tag = "type", rename_all = "lowercase")] pub enum WatchEvent { Change { id: u32 }, Error { id: u32, message: String } }` (JSON shape identical to the TS `WatchEvent`)
  - `pub struct Watchers` with `pub fn new(emit: Arc<dyn Fn(WatchEvent) + Send + Sync>, debounce: Duration) -> Self`, `pub fn start(&self, dir: &str) -> u32` (ids start at 1; non-recursive; bursts within the debounce window yield one `Change`; a watch failure emits one `Error` and the id stays valid), `pub fn stop(&self, id: u32)` (unknown id is a no-op), `pub fn stop_all(&self)`.
  - Commands `watch_start(dir) -> u32` and `watch_stop(id)`; the emitter sends Tauri event `fs:watch-event`.
- [ ] **Step 1: Port tests** from `dirWatcher.test.ts` (same names, debounce 50 ms in tests) plus `watching_deleted_directory_emits_one_error` and `stop_unknown_id_is_noop`.
- [ ] **Step 2: Run** `cargo test watcher` → FAIL.
- [ ] **Step 3: Implement** with `notify::recommended_watcher`; debounce via a per-id timer thread or channel.
- [ ] **Step 4: Run** `cargo test watcher` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): directory watcher"`

### Task 12: Terminal (PTY)

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/Cargo.toml` (`portable-pty`), `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `pub struct PtySessions` with `pub fn spawn(&self, cwd: &str, on_data: Arc<dyn Fn(u32, String) + Send + Sync>, on_exit: Arc<dyn Fn(u32) + Send + Sync>) -> Result<u32, String>` (shell `bash`, 80×24, `TERM=xterm-256color`, empty cwd → home; returns the child pid), `write(pid, data: &str)`, `resize(pid, cols: u16, rows: u16)`, `kill(pid)`, `kill_all()`; all methods on unknown pid are no-ops.
  - Commands `pty_spawn(cwd) -> u32`, `pty_write(pid, data)`, `pty_resize(pid, cols, rows)`, `pty_kill(pid)`; events `terminal:data:{pid}` (payload: string) and `terminal:exit:{pid}` (fired once).
  - `kill_all` is called when the window closes.
- [ ] **Step 1: Write failing tests**: `spawned_shell_echoes_written_input` (write `echo hi\n`, expect `hi` in output within 2 s), `exit_callback_fires_once_when_shell_exits`, `write_after_exit_does_not_panic`, `kill_all_terminates_sessions`.
- [ ] **Step 2: Run** `cargo test pty` → FAIL.
- [ ] **Step 3: Implement** with a reader thread per session.
- [ ] **Step 4: Run** `cargo test pty` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): pty terminal"`

### Task 13: `media://` protocol with range requests

**Files:**
- Create: `src-tauri/src/media.rs`
- Modify: `src-tauri/src/lib.rs` (`register_uri_scheme_protocol("media", …)`), `tauri.conf.json` (CSP allowing `media:` for img/media)

**Interfaces:**
- Produces: `pub fn parse_range(header: &str, len: u64) -> Option<(u64, u64)>` (inclusive start/end, supports `bytes=a-b`, `bytes=a-`, `bytes=-n`; invalid or out-of-range ⇒ `None`), `pub fn guess_mime(path: &str) -> &'static str` (by extension, fallback `application/octet-stream`), and the protocol handler that URL-decodes the path (URL form is `media://<absolute path>` as today), returns `200` for full, `206` with `Content-Range` for ranges, `404` for missing files.
- [ ] **Step 1: Write failing tests**: `parse_range_open_ended`, `parse_range_suffix`, `parse_range_rejects_start_past_end`, `guess_mime_known_and_unknown`, `decodes_percent_encoded_spaces`.
- [ ] **Step 2: Run** `cargo test media` → FAIL.
- [ ] **Step 3: Implement** and register the handler.
- [ ] **Step 4: Run** `cargo test media` → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): media protocol with range support"`

### Task 14: Wire-up, parity check, and smoke test

**Files:**
- Create: `src/api/__tests__/commandParity.test.ts`
- Modify: `src-tauri/src/lib.rs` (single `invoke_handler(tauri::generate_handler![…])` with every command; `on_window_event` → `watchers.stop_all()` and `pty.kill_all()`)

**Interfaces:**
- Consumes: `COMMAND_MAP` (Task 5); every command from Tasks 6–12.

- [ ] **Step 1: Write failing test** `commandParity.test.ts`: reads `src-tauri/src/lib.rs`, extracts the identifiers inside `generate_handler![ … ]`, and asserts the set equals `Object.values(COMMAND_MAP)`.
- [ ] **Step 2: Run** `bun test src/api/__tests__/commandParity.test.ts` → FAIL if any command is unregistered or misnamed.
- [ ] **Step 3: Fix registrations** until it passes; `cd src-tauri && cargo test && cargo clippy -- -D warnings` → exits 0.
- [ ] **Step 4: Smoke test** `bun run tauri:dev` with the current UI: browse folders, rename, copy/paste, trash, watch updates, open-with list, terminal pane, text preview, search. Record anything broken in `docs/superpowers/specs/2026-11-12-spike-results.md` under "Smoke test". (Visual look is the old UI; only function is checked.)
- [ ] **Step 5: Commit** `git commit -m "feat(tauri): register all commands, parity test"`

---

## Self-Review notes

- Spec coverage: gate thresholds (Task 3), api seam (4–5), every one of the 35 methods (6–13; `startDrag` deferred no-op in 5), media protocol (13), tests ported (6–11), Tailwind and library (2). UI rewrite, packaging, and Electron removal are intentionally in the follow-up plan after the gate.
- Naming consistency: command names come only from `COMMAND_MAP`; Task 14 enforces it.
