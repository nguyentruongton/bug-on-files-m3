# Archive Support: `.rar` Extraction, Batch Operations, Multi-File Compression, and Friendly Missing-Tool Guidance

**Date:** 2026-11-25
**Status:** Draft (Pending Builder Review & User Approval)

## 1. Intent & Why

The user has installed `unrar` on Arch Linux and wants **Material 3 File Explorer** to fully support `.rar` archives and make everyday archive workflows much more convenient:
- Extract `.rar` files seamlessly alongside `.zip` and `.tar.*` archives.
- Select multiple archive files (e.g. 2–3 `.rar` or `.zip` files), right-click, and extract all of them at once (either into the current folder or into subfolders).
- Select multiple files/folders, right-click, and compress them into a single archive file.
- Handle missing system archive tools gracefully for low-tech Linux users across different distributions by clearly explaining what is missing and giving an easy copyable install command.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
1. **`.rar` extraction via `unrar`** in both Tauri (`src-tauri`) and Electron (`electron`) backends, with entry counting and real-time progress streaming.
2. **Destination-aware extraction**: support *Extract Here*, *Extract to `<folder>/`* (or *Extract Each to Own Folder* for multi-selection), and *Extract to...* (directory picker).
3. **Batch extraction**: allow selecting multiple archive files and extracting them in one action from the context menu, with clear progress and per-file error reporting.
4. **Multi-file compression**: allow selecting one or more files/folders in a directory and compressing them into a single `.zip` or `.tar.gz` archive via a simple M3 Expressive dialog.
5. **Friendly missing-CLI guidance**: detect when `unrar`, `unzip`, `zip`, or `tar` is missing, identify the Linux distro from `/etc/os-release`, and show an accessible dialog with a one-click **Copy Command** button and plain-language instructions.

### Non-Goals
- Creating `.rar` archives (`unrar` is extract-only; proprietary `rar` CLI is not assumed).
- Browsing inside an archive without extracting it (virtual archive filesystem).
- Interactive password entry UI for encrypted `.rar` files (though password-protected archives must fail fast with a clear message rather than hanging on stdin).

### Anti-Goals
- Never invoke shell interpolation (`sh -c`, string-concatenated commands) for filenames or paths—all CLI invocations must pass discrete argument arrays (`Command::new` / `execFile` / `spawn`).
- Never silently fail or hang indefinitely waiting for terminal prompts (e.g., overwrite prompts or password prompts from `unrar`/`unzip`).
- Never show only a cryptic error code or raw `ENOENT` message to a low-tech user when a CLI dependency is missing.

## 3. Constraints

- **Dual backends**: The repository maintains both Tauri (`src-tauri/src/`) and Electron (`electron/`) backends behind `IApi` (`src/api/types.ts`, `src/api/commandMap.ts`, `src/api/tauriAdapter.ts`, `electron/preload.ts`). Both must stay in sync.
- **Linux CLI availability**: Users may run Arch, Debian/Ubuntu, Fedora, openSUSE, or derivatives. `tar` is almost always present, while `unrar`, `unzip`, and `zip` may need to be installed by the user.
- **`unrar` behavior**: `unrar x -o+ -p- <archive> <destDir>/` must pass `-p-` (do not query password) and `-o+` (overwrite without interactive prompt) so background processes never hang on stdin. `unrar lb <archive>` lists bare filenames for progress counting.

## 4. Approaches Considered

1. **Approach 1 — System CLI Integration (`unrar`, `unzip`, `zip`, `tar`) across Tauri & Electron *(Selected)***
   - Extends existing `extract.rs` and `electron/main.ts` CLI runners to add `unrar` for `.rar`, optional `destDir`, a `compress` command using `zip`/`tar`, and an OS/tool check helper.
   - *Trade-offs:* Lightest footprint, reuses installed `unrar` and existing `fs:extract-progress` + `ProgressIndicator` UI. Requires handling missing binaries cleanly for non-technical users.
2. **Approach 2 — Embedded Rust Crates / Node Native Packages**
   - Bundle extraction/compression libraries directly in Rust and Node.
   - *Trade-offs:* Does not use the user's installed `unrar`, introduces C++ FFI/licensing complexity for `unrar`, bloats builds, and risks behavioral divergence between Tauri and Electron.
3. **Approach 3 — Phased Split (`.rar` + Batch Extract first, Compress later)**
   - *Trade-offs:* Faster initial slice, but leaves out the user's requested multi-file compression workflow.

## 5. Architecture & Detailed Design

### 5.1 Backend: `.rar` Extraction & Destination Support
- **API signature change**:
  - `extractFile(path: string, destDir?: string): Promise<boolean>` in `IApi` (`src/api/types.ts`), `tauriAdapter.ts`, `electron/preload.ts`, `electron/main.ts`, and `src-tauri/src/commands/app.rs`.
  - When `destDir` is omitted, it defaults to `path.parent()` (preserving existing behavior for `ExplorerTab.tsx` single-click toolbar button).
  - When `destDir` is provided, the backend ensures `destDir` exists (`create_dir_all` / `fs.mkdir(..., { recursive: true })`) before running extraction.
- **`.rar` command mapping** (in `src-tauri/src/extract.rs` and `electron/main.ts`):
  - `list_entries_command`: `unrar lb <file>`
  - `extract_command` / `extract_verbose_command`: `unrar x -o+ -p- <file> <destDirWithTrailingSlash>`
  - `parse_extracted_entry_line("unrar", line)`: matches `unrar x` output lines starting with `Extracting  ` (or `Creating    `) and strips trailing status (`OK` / whitespace) to emit the current file path.
  - **Password-protected `.rar`**: if `unrar` exits non-zero and stderr/stdout mentions password/encrypted (e.g. `password` / `encrypted`), emit an error event with a clear code/message (e.g. `ARCHIVE_PASSWORD_REQUIRED` / `"This RAR archive is password-protected."`).

### 5.2 Backend: Multi-File Compression
- **New API**:
  - `compressFiles(paths: string[], destArchivePath: string, format: 'zip' | 'tar.gz'): Promise<boolean>`
  - `COMMAND_MAP.compressFiles = 'compress_files'` in `src/api/commandMap.ts`.
  - Progress event: `'fs:compress-progress'` (`onCompressProgress` in `IApi`), reusing the same payload shape as `ExtractProgressEvent` (`archiveName`, `currentFile`, `extractedCount` -> `processedCount` or keeping `ExtractProgressEvent`-compatible fields, `totalCount`, `percent`, `done`, `error`).
- **Command execution**:
  - All `paths` must share a common parent directory (or `cwd` is set to `dirname(destArchivePath)` and paths are passed relative to `cwd` so archives don't embed `/home/user/...` absolute prefixes).
  - Format `'zip'`: `zip -r <destArchivePath> <relPath1> <relPath2> ...` (parse `adding: <entry>` stdout lines for progress).
  - Format `'tar.gz'`: `tar -czvf <destArchivePath> <relPath1> <relPath2> ...` (parse each stdout line as an entry).
  - Total count can be estimated quickly or progress shown as indeterminate/animated wavy `ProgressIndicator` when total entry count isn't pre-computed.

### 5.3 Backend: Missing-Tool Detection & Distro Guidance
- **Structured missing-tool error**:
  - When spawning `unrar`, `unzip`, `zip`, or `tar` fails with `NotFound` / `ENOENT`, or via a dedicated `checkArchiveTool(tool: string)` / structured error payload:
  - Backend reads `/etc/os-release` (`ID` and `ID_LIKE`) to determine distro family and returns structured metadata:
    - `tool`: `'unrar' | 'unzip' | 'zip' | 'tar'`
    - `distroName`: human-readable name from `PRETTY_NAME` or `ID` (e.g. `"Arch Linux"`, `"Ubuntu"`, `"Fedora"`)
    - `installCommand`: exact command for that distro:
      - Arch family (`arch`, `cachyos`, `endeavouros`, `manjaro`, `garuda`): `sudo pacman -S <pkg>`
      - Debian/Ubuntu family (`debian`, `ubuntu`, `linuxmint`, `pop`): `sudo apt update && sudo apt install <pkg>`
      - Fedora/RHEL (`fedora`, `rhel`, `centos`): `sudo dnf install <pkg>`
      - openSUSE (`opensuse*`, `suse`): `sudo zypper install <pkg>`
      - Fallback: `Install "<pkg>" using your system package manager`

### 5.4 Frontend: Context Menu, Batch Progress, Compress Dialog & Missing-Tool Dialog
- **Context Menu (`src/App.tsx`)**:
  - Determine `allSelectedAreArchives = targetItems.length > 0 && targetItems.every(item => !item.isDirectory && isArchiveFile(item.name))`.
  - When `!isTrashView && allSelectedAreArchives`:
    - `Extract Here` (or `Extract Here (N)` when `N > 1`): extracts each selected archive into its parent directory.
    - `Extract to "<stem>/"` (when `N === 1`) or `Extract Each to Own Folder (N)` (when `N > 1`): computes `<parent>/<archiveStemWithoutExt>` (handling `.tar.gz`/`.tar.xz` stems cleanly) and extracts each into its own folder.
    - `Extract to...`: opens `api.openDirectoryDialog()`, then extracts all selected archives into the chosen folder.
  - When `!isTrashView && targetItems.length > 0`:
    - `Compress...` (or `Compress (N)...` when `N > 1`): opens `CompressDialog`.
- **Batch Extraction Execution**:
  - Runs sequentially across `targetItems` so progress events don't interleave.
  - Progress card in `ExplorerTab.tsx` shows batch index when `totalArchives > 1` (e.g. `Extracting (1/3): part1.rar`).
  - If any archive fails due to a missing CLI tool, abort the batch immediately and open the **Missing Tool Dialog**. For other per-file errors (e.g., corrupted or password-protected), record the failure, continue remaining files, and show a summary toast at the end.
- **Compress Dialog (`CompressDialog`)**:
  - M3 Expressive `Dialog` with filename input (pre-filled with `<singleItemName>.zip` or `<folderName>.zip` / `archive.zip`, validating no `/` or empty name) and format selector (`.zip` / `.tar.gz`).
  - Checks/handles existing target file collision (e.g., inline warning or auto-increment/overwrite confirmation).
- **Missing Tool Dialog (`MissingToolDialog`)**:
  - M3 Expressive `Dialog` designed for non-technical users:
    - Plain-language explanation of why the action couldn't run (e.g., *"To extract .rar files, your computer needs the `unrar` tool."*).
    - Shows detected OS name + the exact install command in a styled code box with a **Copy Command** button (with visual "Copied!" feedback).
    - Simple 3-step instructions: *1. Open your Terminal app → 2. Paste the command and press Enter (enter your password if asked) → 3. Come back and try again.*

## 6. Left to the Builder

- Exact UI copy/labels and styling details matching existing `@bug-on/m3-expressive` components (`Dialog`, `TextField`, `Button`, `ProgressIndicator`).
- Stem stripping helper for compound extensions (`.tar.gz`, `.tar.xz`, `.tgz`) when computing `Extract to "<stem>/"`.
- Unit tests for:
  - `unrar` command construction, `parse_extracted_entry_line("unrar", ...)`, and password error detection in Rust (`src-tauri/src/extract.rs`) and Electron (`electron/__tests__/`).
  - `compress` command construction and `/etc/os-release` distro-to-install-command mapping.
  - Frontend context menu visibility rules (single archive, multiple archives, mixed selection, trash view) and batch extraction/compression orchestration.
