# Archive Support: `.rar` Extraction, Batch Operations, Multi-File Compression, and Friendly Missing-Tool Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.rar` extraction via `unrar`, destination-aware and multi-archive batch extraction, multi-file `.zip`/`.tar.gz` compression, and a distro-aware missing-CLI guidance dialog across both Tauri and Electron backends.

**Architecture:** Both Tauri (`src-tauri`) and Electron (`electron`) backends execute discrete-argument CLI commands (`unrar`, `unzip`, `zip`, `tar`) and stream progress events (`fs:extract-progress`, `fs:compress-progress`). On missing-binary errors (`ENOENT`/`NotFound`), backends parse `/etc/os-release` and return structured install guidance rendered by a low-tech-friendly M3 Expressive dialog on the frontend.

**Tech Stack:** Rust (Tauri v2), Node/TypeScript (Electron 39), React 19, `@bug-on/m3-expressive`, Bun test (`bun test`), Cargo test (`cargo test`).

**Spec:** [2026-11-25-archive-rar-batch-compress-design.md](file:///home/stark/Documents/GitHub/material-3-file-explorer/docs/superpowers/specs/2026-11-25-archive-rar-batch-compress-design.md)

## Global Constraints

- Never invoke shell interpolation (`sh -c` or string-concatenated commands); pass discrete argument arrays to `Command::new` / `execFile` / `spawn`.
- `unrar` must be invoked with `-o+` and `-p-` so background extraction never hangs on overwrite or password stdin prompts.
- Keep Tauri (`src-tauri/src/`) and Electron (`electron/`) `IApi` implementations in sync (`src/api/types.ts`, `src/api/commandMap.ts`, `src/api/tauriAdapter.ts`, `electron/preload.ts`).
- Creating `.rar` archives is a non-goal; compression supports `.zip` and `.tar.gz` only.
- Missing CLI errors must surface a friendly dialog with `/etc/os-release` distro detection and a one-click Copy Command button, never just a raw `ENOENT` toast.

## Review Focus

- **Password-protected `.rar` archive:** `unrar x -o+ -p-` fails fast and emits an `ARCHIVE_PASSWORD_REQUIRED` error instead of hanging. (Pinned in Task 1 & Task 3)
- **Filenames with shell metacharacters, spaces, or quotes (`my "archive" $(whoami).rar`):** Passed as discrete argument array elements without shell interpretation. (Pinned in Task 1 & Task 3)
- **Compound archive extensions (`.tar.gz`, `.tar.xz`, `.tgz`) when computing subfolder names:** `getArchiveStem("foo.tar.gz")` returns `"foo"`, not `"foo.tar"`. (Pinned in Task 4)
- **Missing CLI binary across Linux distros:** Spawn `NotFound`/`ENOENT` maps `/etc/os-release` (`arch`/`ubuntu`/`fedora`/`opensuse`) to the exact package manager command. (Pinned in Task 2 & Task 3)
- **Compressing items with relative paths & filename validation:** `compressFiles` sets `cwd` to the parent directory and passes relative names; `CompressDialog` rejects empty or `/` names. (Pinned in Task 2, Task 3 & Task 5)

---

### Task 1: Rust `.rar` Extraction, `destDir` Support, and Password Error Detection

**Files:**
- Modify: `src-tauri/src/extract.rs:21-283`
- Modify: `src-tauri/src/commands/app.rs:61-70`
- Test: `src-tauri/src/extract.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**
- Produces in `src-tauri/src/extract.rs`:
  - `pub fn extract_command_to(file: &str, dest_dir: Option<&str>) -> Option<(String, Vec<String>)>`
  - `pub fn extract_verbose_command_to(file: &str, dest_dir: Option<&str>) -> Option<(String, Vec<String>)>`
  - `pub fn extract_file_with_progress_to<F>(file: &str, dest_dir: Option<&str>, on_progress: F) -> Result<bool, String>`
  - `pub fn is_password_error(output: &str) -> bool`
- Preserves existing `extract_command(file)`, `extract_verbose_command(file)`, and `extract_file_with_progress(file, on_progress)` as wrappers passing `None`.
- Updates Tauri command `extract_file(app, path: String, dest_dir: Option<String>) -> Result<bool, String>`.

- [ ] **Step 1: Write failing tests in `src-tauri/src/extract.rs`**

Add unit tests in `mod tests` covering:
- `test_extract_command_rar_with_shell_characters`: `extract_command_to("/tmp/my \"archive\" $(whoami).rar", None)` returns `("unrar", vec!["x", "-o+", "-p-", file, "/tmp/"])`.
- `test_extract_command_custom_dest_dir`: `extract_command_to("/tmp/a.zip", Some("/tmp/out"))` returns `("unzip", vec!["-o", "/tmp/a.zip", "-d", "/tmp/out"])`, and for `.rar` returns `("unrar", vec!["x", "-o+", "-p-", "/tmp/a.rar", "/tmp/out/"])`.
- `test_list_entries_command_rar`: `list_entries_command("/tmp/a.rar")` returns `Some(("unrar", vec!["lb", "/tmp/a.rar"]))`.
- `test_parse_extracted_entry_line_unrar`: `"Extracting  folder/file.txt     OK"` -> `Some("folder/file.txt")`, `"Creating    folder                    OK"` -> `Some("folder")`, `"UNRAR 7.00 freeware"` -> `None`.
- `test_is_password_error_detects_encrypted_rar`: `is_password_error("The specified password is incorrect.")` and `is_password_error("Enter password (will not be echoed)")` return `true`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml extract`
Expected: FAIL with missing `extract_command_to`, `is_password_error`, and `.rar` returning `None`.

- [ ] **Step 3: Implement `.rar` extraction, `destDir` support, and password/missing-tool error formatting in `src-tauri/src/extract.rs` and `src-tauri/src/commands/app.rs`**

- Add `"rar"` arm to `extract_command_to`, `list_entries_command`, `extract_verbose_command_to`, and `parse_extracted_entry_line`.
- Ensure `dest_dir` with trailing `/` is passed to `unrar x -o+ -p- <file> <dir>/`, and create `dest_dir` with `std::fs::create_dir_all` if `Some(dir)` is passed to `extract_file_with_progress_to`.
- In `extract_with_command`, if `cmd` fails with `io::ErrorKind::NotFound`, format error as `MISSING_TOOL:<cmd>:<distro_json>` (using helper from Task 2 or inline/shared helper; if Task 2 creates `archive_tools.rs`, keep `extract.rs` calling `crate::archive_tools::format_missing_tool_error(cmd)`). If `status` is non-zero and `is_password_error(&stderr_text)` is true, emit `ARCHIVE_PASSWORD_REQUIRED: This archive is password-protected.`
- Update `commands::app::extract_file(app, path: String, dest_dir: Option<String>)` to call `extract_file_with_progress_to(&path, dest_dir.as_deref(), ...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml extract`
Expected: PASS (update existing `test_extract_command_unsupported_extensions` so `.rar` is no longer in unsupported list; keep `.txt` and no-extension).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/extract.rs src-tauri/src/commands/app.rs
git commit -m "feat(tauri): add unrar extraction, destDir support, and password error detection"
```

---

### Task 2: Rust Multi-File Compression & Distro Missing-Tool Guidance

**Files:**
- Create: `src-tauri/src/archive_tools.rs`
- Modify: `src-tauri/src/commands/app.rs`
- Modify: `src-tauri/src/lib.rs` (register `mod archive_tools;` and `commands::app::compress_files`)
- Test: `src-tauri/src/archive_tools.rs` (inline `#[cfg(test)] mod tests`)

**Interfaces:**
- Produces in `src-tauri/src/archive_tools.rs`:
  - `pub struct MissingToolInfo { pub tool: String, pub package: String, pub distro_name: String, pub install_command: String }`
  - `pub fn parse_os_release_and_command(os_release_content: &str, tool: &str) -> MissingToolInfo`
  - `pub fn format_missing_tool_error(tool: &str) -> String` (returns `MISSING_TOOL:<json>`)
  - `pub fn compress_command(dest_archive: &str, rel_items: &[String], format: &str) -> Result<(String, Vec<String>), String>`
  - `pub fn compress_files_with_progress<F>(paths: &[String], dest_archive: &str, format: &str, on_progress: F) -> Result<bool, String>`
- Produces Tauri command: `compress_files(app, paths: Vec<String>, dest_archive_path: String, format: String) -> Result<bool, String>` emitting `"fs:compress-progress"`.

- [ ] **Step 1: Write failing tests in `src-tauri/src/archive_tools.rs`**

Add tests for:
- `test_parse_os_release_arch_ubuntu_fedora_opensuse`: verifies `unrar` and `zip` map to `sudo pacman -S unrar`, `sudo apt update && sudo apt install unrar`, `sudo dnf install unrar`, `sudo zypper install unrar`, and unknown distro falls back cleanly.
- `test_compress_command_zip_and_targz`: verifies `"zip"` produces `("zip", ["-r", dest, "a.txt", "dir"])` and `"tar.gz"` produces `("tar", ["-czvf", dest, "a.txt", "dir"])`, and invalid format returns `Err`.
- `test_compress_files_with_progress_tar_gz_creates_archive`: creates a tempdir with two files, calls `compress_files_with_progress(..., "tar.gz", ...)`, verifies `Ok(true)`, output `.tar.gz` exists, and `done == true` event was emitted.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml archive_tools`
Expected: FAIL because `archive_tools` module does not exist yet.

- [ ] **Step 3: Implement `src-tauri/src/archive_tools.rs`, wire `commands::app::compress_files` and `lib.rs`, and hook `format_missing_tool_error` into `extract.rs`**

- Compute `cwd` as parent of `paths[0]` (or `dest_archive` parent) and convert `paths` to relative file names via `Path::file_name()` so archives never store full `/home/...` paths.
- Stream stdout lines (`adding: ...` for `zip`, line-by-line for `tar -czvf`) to `"fs:compress-progress"` using `ExtractProgressPayload` structure.
- On `ErrorKind::NotFound` when spawning `zip` or `tar` (and in `extract.rs`), return `format_missing_tool_error(cmd)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/archive_tools.rs src-tauri/src/extract.rs src-tauri/src/commands/app.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add multi-file compression and distro missing-tool detection"
```

---

### Task 3: Electron `.rar` Extraction, `destDir`, Compression, & Distro Guidance

**Files:**
- Modify: `electron/systemUtils.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Test: `electron/__tests__/systemUtils.test.ts`

**Interfaces:**
- Produces in `electron/systemUtils.ts`:
  - `getExtractCommand(filePath: string, destDir?: string): ExtractCommand | null`
  - `getVerboseExtractCommand(filePath: string, destDir?: string): ExtractCommand | null`
  - `getListEntriesCommand(filePath: string): ExtractCommand | null`
  - `parseExtractedEntryLine(cmd: string, line: string): string | null`
  - `isPasswordError(output: string): boolean`
  - `getCompressCommand(destArchive: string, relItems: string[], format: 'zip' | 'tar.gz'): ExtractCommand | null`
  - `parseOsReleaseAndCommand(osReleaseContent: string, tool: string): { tool: string; package: string; distroName: string; installCommand: string }`
- Updates IPC handlers in `electron/main.ts` and `electron/preload.ts`:
  - `fs:extract` accepts `(filePath: string, destDir?: string)`
  - `fs:compress` accepts `(paths: string[], destArchivePath: string, format: 'zip' | 'tar.gz')`, emits `'fs:compress-progress'`
  - `onCompressProgress` exposed in `electron/preload.ts`

- [ ] **Step 1: Write failing tests in `electron/__tests__/systemUtils.test.ts`**

Add tests for:
- `.rar` in `getExtractCommand`, `getVerboseExtractCommand`, `getListEntriesCommand` (including shell metacharacters and custom `destDir`).
- `parseExtractedEntryLine('unrar', 'Extracting  a/b.txt     OK')` -> `'a/b.txt'`.
- `isPasswordError('The specified password is incorrect.')` -> `true`.
- `getCompressCommand('/tmp/out.zip', ['a.txt', 'b'], 'zip')` and `'tar.gz'`.
- `parseOsReleaseAndCommand('ID=arch\nPRETTY_NAME="Arch Linux"', 'unrar')` -> `sudo pacman -S unrar`, plus Ubuntu/Fedora/openSUSE.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test electron/__tests__/systemUtils.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement helpers in `electron/systemUtils.ts`, update `electron/main.ts` and `electron/preload.ts`**

- In `electron/main.ts`, `fs:extract` ensures `destDir` exists via `fs.mkdir(destDir, { recursive: true })` when provided, detects `ENOENT` via `(err as NodeJS.ErrnoException).code === 'ENOENT'` and formats `MISSING_TOOL:<json>` reading `/etc/os-release`, and detects password errors on non-zero exit.
- Implement `fs:compress` handler in `electron/main.ts` mirroring `fs:extract` progress streaming (`fs:compress-progress`) with `cwd = path.dirname(paths[0])` and relative filenames.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test electron/__tests__/systemUtils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/systemUtils.ts electron/main.ts electron/preload.ts electron/__tests__/systemUtils.test.ts
git commit -m "feat(electron): add unrar, destDir, compression, and distro missing-tool detection"
```

---

### Task 4: Frontend API Layer & Archive Utility Helpers

**Files:**
- Modify: `src/api/types.ts`
- Modify: `src/api/commandMap.ts`
- Modify: `src/api/tauriAdapter.ts`
- Create: `src/utils/archiveUtils.ts`
- Test: `src/api/__tests__/tauriAdapter.test.ts`
- Create/Test: `src/utils/__tests__/archiveUtils.test.ts`

**Interfaces:**
- Updates `IApi` (`src/api/types.ts`):
  - `extractFile: (path: string, destDir?: string) => Promise<boolean>`
  - `compressFiles: (paths: string[], destArchivePath: string, format: 'zip' | 'tar.gz') => Promise<boolean>`
  - `onCompressProgress: (cb: (e: ExtractProgressEvent) => void) => () => void`
- Produces in `src/utils/archiveUtils.ts`:
  - `export interface MissingToolInfo { tool: string; package: string; distroName: string; installCommand: string }`
  - `export function getArchiveStem(filename: string): string` (strips `.tar.gz`, `.tar.xz`, `.tgz`, `.zip`, `.rar`, `.tar`, `.gz`, `.xz`, `.7z`, `.iso`)
  - `export function parseMissingToolError(message: string): MissingToolInfo | null`
  - `export function isPasswordArchiveError(message: string): boolean`
  - `export function buildDefaultArchiveName(items: Array<{ name: string; isDirectory: boolean }>, parentDirName: string): string`

- [ ] **Step 1: Write failing tests in `src/api/__tests__/tauriAdapter.test.ts` and `src/utils/__tests__/archiveUtils.test.ts`**

Test:
- `tauriAdapter.extractFile('/a.rar', '/out')` invokes `extract_file` with `{ path: '/a.rar', destDir: '/out' }`.
- `tauriAdapter.compressFiles(['/a', '/b'], '/out.zip', 'zip')` invokes `compress_files` with `{ paths: ['/a', '/b'], destArchivePath: '/out.zip', format: 'zip' }`.
- `getArchiveStem`: `'movie.tar.gz' -> 'movie'`, `'backup.rar' -> 'backup'`, `'archive.TGZ' -> 'archive'`.
- `parseMissingToolError`: parses `'MISSING_TOOL:{"tool":"unrar","package":"unrar","distroName":"Arch Linux","installCommand":"sudo pacman -S unrar"}'` and returns `null` for normal errors.
- `buildDefaultArchiveName`: single item `'notes.txt'` -> `'notes'`, single folder `'docs'` -> `'docs'`, multiple items in `'Downloads'` -> `'Downloads'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/api/__tests__/tauriAdapter.test.ts src/utils/__tests__/archiveUtils.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement API updates and `src/utils/archiveUtils.ts`**

Update `types.ts`, `commandMap.ts`, `tauriAdapter.ts`, and create `src/utils/archiveUtils.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/api/__tests__/tauriAdapter.test.ts src/utils/__tests__/archiveUtils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/types.ts src/api/commandMap.ts src/api/tauriAdapter.ts src/api/__tests__/tauriAdapter.test.ts src/utils/archiveUtils.ts src/utils/__tests__/archiveUtils.test.ts
git commit -m "feat(api): add compressFiles, destDir extractFile, and archive utility helpers"
```

---

### Task 5: Frontend Dialogs (`CompressDialog`, `MissingToolDialog`) & Batch Context Menu

**Files:**
- Create: `src/components/CompressDialog.tsx`
- Create: `src/components/MissingToolDialog.tsx`
- Modify: `src/components/ExplorerTab.tsx` (support optional batch label / compress progress in floating `ProgressIndicator` card)
- Modify: `src/App.tsx` (batch extract menu items, `Compress...` menu item, batch orchestration, dialogs)

**Interfaces:**
- `CompressDialog`: props `{ open: boolean; defaultName: string; onClose: () => void; onConfirm: (filename: string, format: 'zip' | 'tar.gz') => void }`
- `MissingToolDialog`: props `{ info: MissingToolInfo | null; onClose: () => void }`

- [ ] **Step 1: Create `src/components/MissingToolDialog.tsx` and `src/components/CompressDialog.tsx`**

- `MissingToolDialog`: Uses `@bug-on/m3-expressive` `Dialog`, `DialogHeader`, `DialogBody`, `DialogFooter`, `Button`. Explains which tool is missing in plain language, displays `info.distroName` and `info.installCommand` in a monospace copyable box with a **Copy Command** button (`navigator.clipboard.writeText`), and lists 3 simple steps for non-CLI users.
- `CompressDialog`: Uses M3 Expressive `Dialog` with filename input (disallowing empty or `/`), format toggle (`.zip` / `.tar.gz`), and **Compress** / **Cancel** buttons.

- [ ] **Step 2: Wire batch extraction, compression, and progress UI in `src/App.tsx` and `src/components/ExplorerTab.tsx`**

- In `src/App.tsx`:
  - Compute `allSelectedAreArchives = targetItems.length > 0 && targetItems.every(item => !item.isDirectory && isArchiveFile(item.name))`.
  - When `!isTrashView && allSelectedAreArchives`:
    - `Extract Here` (or `Extract Here (${targetItems.length})`)
    - Single: `Extract to "${getArchiveStem(targetItems[0].name)}/"`; Multiple: `Extract Each to Own Folder (${targetItems.length})`
    - `Extract to...` (opens `api.openDirectoryDialog()`, then extracts all selected archives there)
  - When `!isTrashView && targetItems.length > 0`:
    - `Compress${selectionSuffix}...` -> opens `CompressDialog`.
  - Batch extraction helper runs sequentially over `targetItems`, updates a batch progress prefix (e.g. `(1/3)`), aborts immediately and opens `MissingToolDialog` if `parseMissingToolError` matches, surfaces password errors clearly, and shows a summary toast on completion.
  - Listen to `api.onCompressProgress` alongside `api.onExtractProgress` in `ExplorerTab.tsx` so compression also animates the floating `ProgressIndicator`.

- [ ] **Step 3: Run full verification (build, lint, unit tests, Rust tests)**

Run: `npm run build && npm run lint && bun test && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: All builds, lint, JS/TS tests, and Rust tests PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/CompressDialog.tsx src/components/MissingToolDialog.tsx src/components/ExplorerTab.tsx src/App.tsx
git commit -m "feat(ui): add batch extract, multi-file compress, and missing-tool guidance dialogs"
```
