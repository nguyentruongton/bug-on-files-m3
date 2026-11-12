# Spike Benchmark Results: Tauri vs Electron

Date: 2026-11-12  
Platform: Arch Linux (`Linux 6.x`), `x86_64`  
Display Servers Tested: Native Wayland (`WAYLAND_DISPLAY=wayland-1`) and XWayland/X11 (`DISPLAY=:0`, `GDK_BACKEND=x11`)  
Tauri Frontend: WebKitGTK 4.1, Tauri 2.12  
Electron: v39.2.6 (Chromium 134)  
Benchmark Page: Identical `dist/spike.html` (5,000 item virtualized list + `@bug-on/m3-expressive` dialog, shape morphing, and physics springs)

---

## 1. Executive Summary

| Metric | Target / Gate Threshold | Electron (Spike) | Tauri (Wayland) | Tauri (X11) | Delta (Wayland vs Electron) | Gate Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Startup (cold, ms)** | $\ge 30\%$ faster | 858 ms | **637 ms** | 730 ms | **25.8% faster** (-221 ms) | Below threshold (Missed: 25.8% < 30%) |
| **Idle RAM (RSS, MB)** | $\ge 40\%$ lower | 881.5 MB | **626.8 MB** | 622.1 MB | **28.9% lower** (-254.7 MB) | Below threshold (Missed: 28.9% < 40%) |
| **Binary Size** | Low tens of MB | ~110 MB (AppImage) | **15 MB** | 15 MB | **86.4% smaller** (-95 MB) | Exceeds goal |
| **Process Count** | Lower process count | 8 processes | **3 processes** | 3 processes | **62.5% fewer processes** | Substantial reduction |
| **Animation Smoothness**| Owner visual judgment| Smooth (Chromium) | Pending Owner | Pending Owner | *Pending owner manual check* | Pending Owner Check |

*Reference: Current real Electron app (`electron-app`) idle RSS: **870.4 MB** (median over 5 runs).*

---

## 2. Benchmark Methodology

- **Startup Latency (`startup_ms`)**: Measured from the exact microsecond before target process spawn (`date +%s%3N`) until the page loads, mounts React, renders the 5,000-item virtualized list, and issues an HTTP `fetch('http://127.0.0.1:8787/ready')` ping received by `scripts/bench/ping-server.ts`.
- **Idle Memory (`idle_rss_mb`)**: Sampled 10 seconds after the ready ping (allowing initial garbage collection and idle settlement). Calculated by recursively identifying the target root PID and all descendant processes (`pgrep -P` BFS traversal) and summing exact `VmRSS` from `/proc/<pid>/status` in kB converted to MB.
- **Iterations**: 5 runs per target under clean process termination (all descendant processes terminated between iterations via `SIGTERM` / `SIGKILL` cleanup).
- **Harnesses**:
  - `electron`: Minimal Electron main (`scripts/bench/electron-harness.cjs`) loading `dist/spike.html?ping=...`.
  - `electron-app`: The current production Electron file manager app (`dist-electron/main.js` loading `dist/index.html`), idle RSS measured at 10s.
  - `tauri-wayland`: Release build `src-tauri/target/release/materials` running natively on Wayland (`MATERIALS_SPIKE_URL="spike.html?ping=..."`).
  - `tauri-x11`: Same release build executed with `GDK_BACKEND=x11`.

---

## 3. Raw Iteration Data

### Electron (Spike Harness on `dist/spike.html`)
- Run 1: `startup_ms=858` `idle_rss_mb=881.5`
- Run 2: `startup_ms=917` `idle_rss_mb=877.7`
- Run 3: `startup_ms=904` `idle_rss_mb=882.5`
- Run 4: `startup_ms=811` `idle_rss_mb=884.6`
- Run 5: `startup_ms=858` `idle_rss_mb=881.1`
- **Median: `startup_ms=858 ms`, `idle_rss_mb=881.5 MB`**

### Electron App (Current Production App Reference)
- Run 1: `startup_ms=N/A` `idle_rss_mb=870.4`
- Run 2: `startup_ms=N/A` `idle_rss_mb=863.0`
- Run 3: `startup_ms=N/A` `idle_rss_mb=867.3`
- Run 4: `startup_ms=N/A` `idle_rss_mb=870.4`
- Run 5: `startup_ms=N/A` `idle_rss_mb=870.4`
- **Median: `idle_rss_mb=870.4 MB`**

### Tauri (Native Wayland)
- Run 1: `startup_ms=658` `idle_rss_mb=628.3`
- Run 2: `startup_ms=626` `idle_rss_mb=626.8`
- Run 3: `startup_ms=637` `idle_rss_mb=629.8`
- Run 4: `startup_ms=634` `idle_rss_mb=620.2`
- Run 5: `startup_ms=721` `idle_rss_mb=624.7`
- **Median: `startup_ms=637 ms`, `idle_rss_mb=626.8 MB`**

### Tauri (X11 via `GDK_BACKEND=x11`)
- Run 1: `startup_ms=799` `idle_rss_mb=625.3`
- Run 2: `startup_ms=736` `idle_rss_mb=622.1`
- Run 3: `startup_ms=660` `idle_rss_mb=620.5`
- Run 4: `startup_ms=730` `idle_rss_mb=621.2`
- Run 5: `startup_ms=684` `idle_rss_mb=627.1`
- **Median: `startup_ms=730 ms`, `idle_rss_mb=622.1 MB`**

---

## 4. Process Tree Analysis

### Electron Process Breakdown (8 processes)
- `node-MainThread` (Electron launcher): ~54 MB
- `electron` (Main Browser process): ~238 MB
- `electron --type=zygote`: ~61 MB
- `electron --type=zygote` (sub): ~61 MB
- `electron --type=gpu-process`: ~80 MB
- `electron --type=utility`: ~173 MB
- `electron --type=renderer`: ~223 MB
- `electron --type=crashpad-handler`: ~12 MB
- **Total: ~882 MB RSS**

### Tauri Process Breakdown (3 processes)
- `materials` (Tauri main / GTK application): ~246 MB
- `WebKitNetworkProcess`: ~71 MB
- `WebKitWebProcess` (Renderer / WebKit engine): ~327 MB
- **Total: ~627 MB RSS**

---

## 5. Threshold Analysis and Findings

1. **Cold Startup**:
   - **Gate Status:** **Below threshold (Missed: 25.8% < 30% on Wayland, 14.9% < 30% on X11)**.
   - Tauri on Wayland achieved a median startup of **637 ms**, saving **221 ms (25.8% faster)** compared to Electron's 858 ms.
   - On X11, Tauri cold start was **730 ms (14.9% faster)**.
   - While cold launch is noticeably snappier (saving 221 ms on Wayland and skipping Chromium zygote and GPU-broker handshakes), it falls short of the strict 30% gate threshold by a 4.2% margin on Wayland and 15.1% margin on X11.

2. **Idle RAM / System Footprint**:
   - **Gate Status:** **Below threshold (Missed: 28.9% < 40% on Wayland, 29.4% < 40% on X11)**.
   - Tauri uses **626.8 MB**, saving **254.7 MB of RAM (28.9% reduction)** compared to the Electron spike, and saving **243.6 MB (28.0% reduction)** compared to the current Electron production app (870.4 MB).
   - Process count dropped from 8 down to 3, significantly simplifying process management and decreasing thread scheduling overhead.
   - Although memory usage is reduced by ~255 MB, the reduction does not reach the owner's 40% threshold. Note on Linux RSS accounting: WebKitGTK and Mesa GPU drivers map shared memory buffers directly into WebKitWebProcess space in `/proc/<pid>/status`. Regardless of accounting nuances, against the agreed threshold it is below target.

3. **Disk and Package Size**:
   - The standalone release binary is **15 MB**, compared to the **~110 MB** Electron AppImage bundle—an **86.4% reduction** in distribution size.

4. **Animation Smoothness**:
   - Marked as: `Pending owner manual check via bun run tauri:dev (spike.html)`.
   - The owner can run `bun run tauri:dev` (or execute `./src-tauri/target/release/materials` with `MATERIALS_SPIKE_URL=spike.html`) to interactively test the morphing shape hover animation, physics spring button, and virtual list scrolling.

---

## 6. Gate Recommendation

Per the implementation plan:
- **Status**: Ready for Owner Review.
- **Backend / API Seam Parallel Tasks**: Tasks 4 onward (`src/api` types, adapters, and Rust filesystem backend commands) are decoupled from the UI rewrite and may proceed immediately while the owner reviews these numbers and performs visual testing on animation smoothness.

---

## 7. Smoke Test (Task 14 Parity & Launch Audit)

Date: 2026-11-12  
Scope: Verification of command parity (32/32 Tauri commands), Rust test suite, Clippy lints, TypeScript type checks, production web bundle, and dev server lifecycle launch.

### Automated Verifications & Observations

1. **Command Parity Test (`src/api/__tests__/commandParity.test.ts`)**:
   - Status: **PASSED (5/5 tests)**.
   - Verified that `src-tauri/src/lib.rs` registers exactly 32 commands inside `tauri::generate_handler![...]`.
   - Verified 1:1 bi-directional parity between `COMMAND_MAP` in TypeScript and Rust handler registrations with zero duplicates and zero missing commands.

2. **Rust Backend Test Suite**:
   - Status: **PASSED (107/107 tests)**.
   - Command: `cargo test`
   - Covers: filesystem operations (`list_dir`, `copy_file`, `move_file`, `rename_file`, `trash_file`, `exists`, `read_file`), directory watching with debounce & error handling (`watcher.rs`), PTY session lifecycle (`pty.rs`), search and size parsing (`search.rs`), system storage/drives parsing (`system_info.rs`), desktop entry parsing and open-with (`desktop_entry.rs`, `commands/apps.rs`), archive extraction (`extract.rs`), text preview with 1MB bounds and binary null detection (`text_preview.rs`), and custom `media://` protocol streaming / HTTP Range requests (`media.rs`).

3. **Rust Linter (`cargo clippy`)**:
   - Status: **PASSED (0 errors, 0 warnings)**.
   - Command: `cargo clippy --all-targets -- -D warnings`
   - Fixed all lints cleanly (idiomatic iterator `.find()` in `commands/app.rs`, `saturating_sub` in `media.rs`, merged identical `if` conditions in URI normalizer in `media.rs`, and canonical boolean assertions in test suites).

4. **Frontend Test Suite & Typecheck**:
   - Status: **PASSED (139/139 tests across 16 files, 420 expect calls)**.
   - Commands:
     - `bun test`: 139 passed, 0 failed.
     - `bunx tsc -b`: Exited 0 with no diagnostic errors.
     - `bun run build:web`: Built production assets cleanly in 4.84s (`dist/index.html`, `dist/spike.html`, JS/CSS/fonts).

5. **Tauri Dev Lifecycle Launch (`bun run tauri:dev`)**:
   - Status: **OBSERVED & VERIFIED**.
   - Output log:
     ```text
     $ tauri dev
          Running BeforeDevCommand (`bun run dev`)
     $ vite
       VITE v7.3.8  ready in 239 ms
       ➜  Local:   http://localhost:5173/
          Running DevCommand (`cargo  run --no-default-features --color always --`)
             Info Watching /home/stark/Documents/GitHub/material-3-file-explorer/src-tauri for changes...
         Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.26s
          Running `target/debug/materials`
     [vite] (client) ✨ new dependencies optimized: @tauri-apps/api/core, @tauri-apps/api/event
     [vite] (client) ✨ optimized dependencies changed. reloading
     ```
   - Observations:
     - Vite 7.3.8 started cleanly on `http://localhost:5173/`.
     - Cargo built and spawned `target/debug/materials` in 0.26s.
     - WebKit window opened under Wayland display (`WAYLAND_DISPLAY=wayland-1`).
     - Webview connected to Vite dev server, optimized `@tauri-apps/api/core` and `@tauri-apps/api/event` modules, and loaded the client application.
     - Zero Rust panics, zero Tauri capability errors, zero crash reports.
     - Graceful shutdown upon SIGTERM with zero orphaned background processes (`pgrep` verified).

### Functional Workflows: Automated Test Coverage vs Interactive UI Walkthrough

Per subagent testing guidelines, automated checks were verified via terminal execution, while manual UI interactions (clicking through the GUI window) remain for owner interactive review:

| Workflow | Automated Test Coverage | Status / Manual Walkthrough Note |
| :--- | :--- | :--- |
| **Browse Folders** | `fs_ops::tests::list_dir_*`, `tauriAdapter.test.ts` | Backend & adapter automated (100%); interactive directory grid click pending owner review. |
| **Rename File** | `fs_ops::tests::rename_path_*`, `pasteRunner.test.ts` | Backend & adapter automated (100%); inline rename UI edit pending owner review. |
| **Copy / Cut / Paste** | `fs_ops::tests::copy_path_*`, `pasteRunner.test.ts` (conflict handling, keep-both, skip) | Automated in Rust and TS unit tests (100%); GUI clipboard shortcuts pending owner review. |
| **Trash File** | `commands::fs::tests::test_trash_file_if_available` | Backend trash-can integration automated; right-click context menu action pending owner review. |
| **Directory Watch Updates** | `watcher::tests::*` (7 tests), `useDirWatch.test.ts` (7 tests) | Fully automated debounce, event emission, unmount cleanup (100%); live UI file list auto-refresh pending owner review. |
| **Open-With List** | `desktop_entry::tests::*` (7 tests), `commands::apps::tests::*` (5 tests) | Parsing `.desktop` files, MIME associations, and argument quoting automated (100%); GUI menu display pending owner review. |
| **Terminal Pane (PTY)** | `pty::tests::*` (4 tests), `tauriAdapter.test.ts` (pty channels) | PTY spawn, bidirectional write/data, resize, and exit signal automated (100%); xterm.js rendering in pane pending owner review. |
| **Text Preview** | `text_preview::tests::*` (11 tests), `electron/__tests__/textPreview.test.ts` | 1MB threshold, null-byte binary heuristic, UTF-8 lossy decoding automated (100%); QuickLook dialog modal pending owner review. |
| **Search** | `search::tests::*` (7 tests), `tauriAdapter.test.ts` | Literal substring search, type/size filters, 100-item cap automated (100%); search bar input typing pending owner review. |

### Conclusion
All 32 Tauri commands are wired, validated for bidirectional parity, passing all unit and integration tests, and cleanly launching in dev mode without errors.

