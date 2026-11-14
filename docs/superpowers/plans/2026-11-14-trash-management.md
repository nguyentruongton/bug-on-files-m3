# Trash Management & Delete Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-featured Trash view (`app://trash`) with inspect, restore (auto-creating missing parent folders and auto-renaming collisions), permanent delete, and empty trash capabilities, alongside a unified M3 Expressive delete confirmation dialog controlled by a Settings toggle (enabled by default).

**Architecture:** Extend `FileEntry` and `IFile` with optional `trashId` and `originalParent` metadata while mapping `path` to the actual trashed payload inside `<trash_dir>/files/<stem>` so existing thumbnails and QuickLook previews work unchanged. Integrate `app://trash` into `ExplorerTab`, `FileList`, `Sidebar`, `Omnibar`, and `App` via an `isTrash` mode branch, and route all move-to-trash and permanent-purge actions through M3 `Dialog` modals in `App.tsx`.

**Tech Stack:** Rust (`tauri` 2, `trash` 5.3, `serde`), TypeScript, React 19, `@bug-on/m3-expressive`, `bun test`, `cargo test`.

**Spec:** [2026-11-14-trash-management-design.md](file:///home/stark/Documents/GitHub/material-3-file-explorer/docs/superpowers/specs/2026-11-14-trash-management-design.md)

## Global Constraints

- Primary backend is Rust/Tauri (`src-tauri`) on Linux (FreeDesktop.org Trash specification v1.0 via crate `trash = "5.3.0"`).
- Never call `window.confirm` or `window.alert` anywhere in the delete or trash workflows.
- Permanent deletion (`Delete Permanently` and `Empty Trash`) MUST always show an M3 confirmation `Dialog`, even when `settings.confirmTrash` is `false`.
- `FileList.tsx` uses `useVirtualWindow` with fixed row heights (`FILE_ROW_HEIGHT = 56`, `HEADER_ROW_HEIGHT_WITH_GAP = 38`); Trash rows in List view must preserve the `h-14` (56px) row height.
- Maintain 1:1 parity between `COMMAND_MAP` (`src/api/commandMap.ts`) and `tauri::generate_handler!` (`src-tauri/src/lib.rs`), verified by `src/api/__tests__/commandParity.test.ts` (37 commands total).
- Rust unit tests must NEVER call `empty_trash()` against the developer's real `~/.local/share/Trash`; isolate tests or purge only specific test-created `trash_id`s.

## Review Focus

- Restoring a file or directory across filesystems (e.g. from `~/.local/share/Trash/files` on `/` to `/tmp` on `tmpfs`) must not fail with `EXDEV` (`CrossesDevices`) or leave an empty 0-byte placeholder behind -> covered by Task 1 (`restore_one_trash_item` uses `fs_ops::move_path` + `remove_file(&info_path)`).
- Restoring multiple items that originally had the same path ("restore twins") or restoring an item when `<stem> (restored)<ext>` already exists must increment cleanly to `<stem> (restored 2)<ext>` without overwriting existing files -> covered by Task 1 unit tests.
- Dotfiles (e.g. `.bashrc`), extensionless files (`Makefile`), and directories colliding on restore must append ` (restored)` at the end (`.bashrc (restored)`, `Makefile (restored)`) rather than before a leading dot -> covered by Task 1 unit tests.
- Pressing `Delete` key inside `app://trash` must trigger `onPurgeRequest` (permanent delete confirmation) instead of re-trashing already trashed files -> covered by Task 4.
- Searching via Omnibar while inside `app://trash` must filter trashed items client-side by `name` and `originalParent` instead of calling backend `find` on the virtual URI `app://trash` -> covered by Task 2 and Task 4.

---

### Task 1: Rust Backend Trash Operations & Tauri Commands

**Files:**
- Modify: `src-tauri/src/fs_ops.rs`
- Modify: `src-tauri/src/search.rs`
- Modify: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces in `src-tauri/src/fs_ops.rs`:
  - `FileEntry` extended with:
    ```rust
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trash_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_parent: Option<String>,
    ```
  - `pub fn trash_payload_path_from_info(info_path: &std::path::Path) -> Option<std::path::PathBuf>`
  - `pub fn resolve_non_colliding_restore_name(parent: &std::path::Path, original_name: &str, is_dir: bool) -> String`
  - `pub fn list_trash() -> Result<Vec<FileEntry>, String>`
  - `pub fn restore_trash_items(ids: &[String]) -> Result<bool, String>`
  - `pub fn purge_trash_items(ids: &[String]) -> Result<bool, String>`
  - `pub fn empty_trash() -> Result<bool, String>`
- Produces in `src-tauri/src/commands/fs.rs` & registers in `src-tauri/src/lib.rs`:
  - `pub fn list_trash() -> Result<Vec<FileEntry>, String>`
  - `pub fn restore_trash_items(ids: Vec<String>) -> Result<bool, String>`
  - `pub fn purge_trash_items(ids: Vec<String>) -> Result<bool, String>`
  - `pub fn empty_trash() -> Result<bool, String>`

- [ ] **Step 1: Write failing Rust unit tests in `src-tauri/src/fs_ops.rs` and `src-tauri/src/commands/fs.rs`**

Add to `mod tests` in `src-tauri/src/fs_ops.rs`:
```rust
#[test]
fn resolve_non_colliding_restore_name_handles_files_dirs_and_dotfiles() {
    let temp = tempfile::tempdir().unwrap();
    let parent = temp.path();

    // No collision -> original name kept
    assert_eq!(
        resolve_non_colliding_restore_name(parent, "report.pdf", false),
        "report.pdf"
    );

    // First collision -> "report (restored).pdf"
    std::fs::write(parent.join("report.pdf"), "v1").unwrap();
    assert_eq!(
        resolve_non_colliding_restore_name(parent, "report.pdf", false),
        "report (restored).pdf"
    );

    // Second collision -> "report (restored 2).pdf"
    std::fs::write(parent.join("report (restored).pdf"), "v2").unwrap();
    assert_eq!(
        resolve_non_colliding_restore_name(parent, "report.pdf", false),
        "report (restored 2).pdf"
    );

    // Directory with dot in name -> suffix at the end
    std::fs::create_dir(parent.join("my.folder")).unwrap();
    assert_eq!(
        resolve_non_colliding_restore_name(parent, "my.folder", true),
        "my.folder (restored)"
    );

    // Dotfile without secondary extension -> suffix at the end
    std::fs::write(parent.join(".bashrc"), "rc").unwrap();
    assert_eq!(
        resolve_non_colliding_restore_name(parent, ".bashrc", false),
        ".bashrc (restored)"
    );
}

#[test]
fn trash_payload_path_from_info_resolves_files_sibling() {
    let info = std::path::Path::new("/home/user/.local/share/Trash/info/doc.txt.trashinfo");
    assert_eq!(
        trash_payload_path_from_info(info),
        Some(std::path::PathBuf::from("/home/user/.local/share/Trash/files/doc.txt"))
    );
}
```

Add to `mod tests` in `src-tauri/src/commands/fs.rs`:
```rust
#[test]
fn test_trash_lifecycle_list_restore_with_collision_and_missing_parent_and_purge() {
    let temp = tempfile::tempdir().unwrap();
    let nested_parent = temp.path().join("deleted_parent");
    std::fs::create_dir_all(&nested_parent).unwrap();

    let file_a = nested_parent.join("note.txt");
    std::fs::write(&file_a, "first version").unwrap();

    // If system trash is unavailable in this environment, skip gracefully
    if trash_file(file_a.to_str().unwrap().into()).is_err() {
        return;
    }
    assert!(!file_a.exists());

    // Create a new file at the same path to force a collision on restore,
    // and also trash a second file to test purge_trash_items
    std::fs::write(&file_a, "blocking version").unwrap();
    let file_b = nested_parent.join("purge_me.txt");
    std::fs::write(&file_b, "to be purged").unwrap();
    trash_file(file_b.to_str().unwrap().into()).unwrap();

    let all_trashed = list_trash().unwrap();
    let nested_parent_str = nested_parent.to_string_lossy().into_owned();
    let entry_a = all_trashed
        .iter()
        .find(|e| e.name == "note.txt" && e.original_parent.as_deref() == Some(nested_parent_str.as_str()))
        .expect("trashed note.txt must appear in list_trash");
    let entry_b = all_trashed
        .iter()
        .find(|e| e.name == "purge_me.txt" && e.original_parent.as_deref() == Some(nested_parent_str.as_str()))
        .expect("trashed purge_me.txt must appear in list_trash");

    let id_a = entry_a.trash_id.clone().expect("must have trash_id");
    let id_b = entry_b.trash_id.clone().expect("must have trash_id");

    // Restore entry_a while "note.txt" exists -> must create "note (restored).txt"
    assert!(restore_trash_items(vec![id_a]).unwrap());
    let restored_collision = nested_parent.join("note (restored).txt");
    assert_eq!(std::fs::read_to_string(&restored_collision).unwrap(), "first version");
    assert_eq!(std::fs::read_to_string(&file_a).unwrap(), "blocking version");

    // Purge entry_b -> must remove it from trash without restoring
    assert!(purge_trash_items(vec![id_b.clone()]).unwrap());
    assert!(!nested_parent.join("purge_me.txt").exists());
    let after_purge = list_trash().unwrap();
    assert!(!after_purge.iter().any(|e| e.trash_id.as_deref() == Some(id_b.as_str())));
}
```

- [ ] **Step 2: Run `cargo test` to verify compilation fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: FAIL with missing functions `resolve_non_colliding_restore_name`, `trash_payload_path_from_info`, `list_trash`, `restore_trash_items`, `purge_trash_items`.

- [ ] **Step 3: Implement trash operations in `src-tauri/src/fs_ops.rs`, `src-tauri/src/search.rs`, `src-tauri/src/commands/fs.rs`, and `src-tauri/src/lib.rs`**

1. In `src-tauri/src/fs_ops.rs` and `src-tauri/src/search.rs`:
   - Add `pub trash_id: Option<String>` and `pub original_parent: Option<String>` (both with `#[serde(skip_serializing_if = "Option::is_none")]`) to `FileEntry`, setting both to `None` in `list_dir`, `search`, and existing test struct literals.
2. In `src-tauri/src/fs_ops.rs`, implement:
   - `pub fn trash_payload_path_from_info(info_path: &std::path::Path) -> Option<std::path::PathBuf>`:
     ```rust
     pub fn trash_payload_path_from_info(info_path: &std::path::Path) -> Option<std::path::PathBuf> {
         let trash_root = info_path.parent()?.parent()?;
         let stem = info_path.file_stem()?;
         Some(trash_root.join("files").join(stem))
     }
     ```
   - `pub fn resolve_non_colliding_restore_name(parent: &std::path::Path, original_name: &str, is_dir: bool) -> String`:
     ```rust
     pub fn resolve_non_colliding_restore_name(
         parent: &std::path::Path,
         original_name: &str,
         is_dir: bool,
     ) -> String {
         if parent.join(original_name).symlink_metadata().is_err() {
             return original_name.to_string();
         }
         let (stem, ext) = if is_dir {
             (original_name, "")
         } else {
             match original_name.rfind('.') {
                 Some(idx) if idx > 0 && idx < original_name.len() - 1 => {
                     (&original_name[..idx], &original_name[idx..])
                 }
                 _ => (original_name, ""),
             }
         };
         let first = format!("{} (restored){}", stem, ext);
         if parent.join(&first).symlink_metadata().is_err() {
             return first;
         }
         let mut counter = 2usize;
         loop {
             let candidate = format!("{} (restored {}){}", stem, counter, ext);
             if parent.join(&candidate).symlink_metadata().is_err() {
                 return candidate;
             }
             counter += 1;
         }
     }
     ```
   - `pub fn list_trash() -> Result<Vec<FileEntry>, String>`:
     - Uses `trash::os_limited::list().map_err(|e| e.to_string())?`.
     - For each `item`:
       - Computes `info_path = std::path::PathBuf::from(&item.id)`.
       - Resolves `payload_path = trash_payload_path_from_info(&info_path)`.
       - Inspects `trash::os_limited::metadata(&item)` (falling back to `payload_path.as_ref().and_then(|p| std::fs::symlink_metadata(p).ok())`; if neither exists, skips stale `.trashinfo`).
       - Sets `is_directory`, `size` (`0` for directories, byte length for files), `mtime_ms` (`if item.time_deleted > 0 { (item.time_deleted as u64) * 1000 } else { 0 }`), `media_kind` (`if is_directory { None } else { payload_path.as_deref().and_then(sniff_ts_media_kind) }`), `trash_id: Some(item.id.to_string_lossy().into_owned())`, `original_parent: Some(item.original_parent.to_string_lossy().into_owned())`, and `path` to `payload_path` string (or `trash_id` fallback).
     - Sorts `result.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms).then_with(|| a.name.cmp(&b.name)))`.
   - `pub fn restore_trash_items(ids: &[String]) -> Result<bool, String>`:
     - Lists items via `trash::os_limited::list()`, builds a `HashSet<&str>` of `ids`.
     - For each matching `item`:
       - Resolves `info_path = std::path::PathBuf::from(&item.id)` and `payload_path = trash_payload_path_from_info(&info_path).ok_or_else(|| "Invalid trash info path".to_string())?`.
       - Checks `let is_dir = std::fs::symlink_metadata(&payload_path).map(|m| m.is_dir()).unwrap_or(false);`.
       - Calls `std::fs::create_dir_all(&item.original_parent).map_err(|e| format!("Failed to create parent directory: {}", e))?;`.
       - Resolves `target_name = resolve_non_colliding_restore_name(&item.original_parent, &item.name.to_string_lossy(), is_dir)`.
       - Moves `payload_path` to `item.original_parent.join(&target_name)` using `move_path` (which supports cross-device moves cleanly), then removes `info_path` via `std::fs::remove_file(&info_path)`.
   - `pub fn purge_trash_items(ids: &[String]) -> Result<bool, String>`:
     - Filters `trash::os_limited::list()` to items whose `id.to_string_lossy()` is in `ids`, then calls `trash::os_limited::purge_all(matching).map_err(|e| e.to_string())`.
   - `pub fn empty_trash() -> Result<bool, String>`:
     - Lists all items via `trash::os_limited::list()` and calls `trash::os_limited::purge_all(all).map_err(|e| e.to_string())`.
3. Expose `list_trash`, `restore_trash_items`, `purge_trash_items`, and `empty_trash` in `src-tauri/src/commands/fs.rs` with `#[tauri::command(rename_all = "camelCase")]` and register all four in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Run `cargo test` to verify all Rust tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (0 failed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/fs_ops.rs src-tauri/src/search.rs src-tauri/src/commands/fs.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add list, restore, purge, and empty trash commands"
```

---

### Task 2: Frontend API Contract, Adapter, `FileSystemService` & Trash Utils

**Files:**
- Modify: `src/types/files.ts`
- Modify: `src/api/types.ts`
- Modify: `src/api/commandMap.ts`
- Modify: `src/api/tauriAdapter.ts`
- Modify: `src/services/FileSystemService.ts`
- Modify: `src/utils/fileUtils.ts`
- Modify: `src/api/__tests__/commandParity.test.ts`
- Modify: `src/api/__tests__/tauriAdapter.test.ts`
- Modify: `src/utils/__tests__/fileUtils.test.ts`

**Interfaces:**
- Consumes: Tauri commands `list_trash`, `restore_trash_items`, `purge_trash_items`, `empty_trash` from Task 1.
- Produces:
  - `IFile` in `src/types/files.ts` with `trashId?: string; originalParent?: string;`
  - `IApi` in `src/api/types.ts` with:
    - `listTrash: () => Promise<IFile[]>;`
    - `restoreTrashItems: (ids: string[]) => Promise<boolean>;`
    - `purgeTrashItems: (ids: string[]) => Promise<boolean>;`
    - `emptyTrash: () => Promise<boolean>;`
  - `FileSystemService` in `src/services/FileSystemService.ts` with:
    - `listTrash(): Promise<IFile[]>`
    - `restoreTrash(ids: string[]): Promise<boolean>`
    - `purgeTrash(ids: string[]): Promise<boolean>`
    - `emptyTrash(): Promise<boolean>`
  - In `src/utils/fileUtils.ts`:
    - `export function formatOriginalParent(originalParent?: string, homePath?: string): string`
    - `export function filterTrashFiles(files: IFile[], query: string): IFile[]`

- [ ] **Step 1: Write failing tests in `src/api/__tests__/commandParity.test.ts`, `src/api/__tests__/tauriAdapter.test.ts`, and `src/utils/__tests__/fileUtils.test.ts`**

1. In `src/api/__tests__/commandParity.test.ts`, update the count expectation from `33` to `37`:
```ts
test('generate_handler registers exactly 37 commands matching COMMAND_MAP', () => {
    expect(registeredCommands.length).toBe(37);
    expect(registeredSet.size).toBe(commandMapSet.size);
});
```
2. In `src/api/__tests__/tauriAdapter.test.ts`, add:
```ts
test('listTrash maps trashId and originalParent, and restoreTrashItems/purgeTrashItems/emptyTrash invoke expected commands', async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    const invoke = async (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === 'list_trash') {
            return [
                {
                    name: 'deleted.txt',
                    path: '/home/u/.local/share/Trash/files/deleted.txt',
                    isDirectory: false,
                    size: 42,
                    mtimeMs: 1700000000000,
                    trashId: '/home/u/.local/share/Trash/info/deleted.txt.trashinfo',
                    originalParent: '/home/u/Documents',
                },
            ];
        }
        return true;
    };
    const listen = async () => () => {};
    const adapter = createTauriAdapter(invoke, listen);

    const items = await adapter.listTrash();
    expect(items).toHaveLength(1);
    expect(items[0].trashId).toBe('/home/u/.local/share/Trash/info/deleted.txt.trashinfo');
    expect(items[0].originalParent).toBe('/home/u/Documents');

    await adapter.restoreTrashItems(['id1']);
    await adapter.purgeTrashItems(['id2']);
    await adapter.emptyTrash();

    expect(calls).toEqual([
        { cmd: 'list_trash', args: undefined },
        { cmd: 'restore_trash_items', args: { ids: ['id1'] } },
        { cmd: 'purge_trash_items', args: { ids: ['id2'] } },
        { cmd: 'empty_trash', args: undefined },
    ]);
});
```
3. In `src/utils/__tests__/fileUtils.test.ts`, add tests for `formatOriginalParent` and `filterTrashFiles`:
```ts
test('formatOriginalParent shortens home prefix to ~', () => {
    expect(formatOriginalParent('/home/stark/Documents/work', '/home/stark')).toBe('~/Documents/work');
    expect(formatOriginalParent('/home/stark', '/home/stark')).toBe('~');
    expect(formatOriginalParent('/var/log', '/home/stark')).toBe('/var/log');
    expect(formatOriginalParent(undefined, '/home/stark')).toBe('—');
});

test('filterTrashFiles matches name or originalParent case-insensitively', () => {
    const items: IFile[] = [
        { name: 'Report.pdf', path: '/t/1', isDirectory: false, size: 10, mtime: new Date(), originalParent: '/home/stark/Work' },
        { name: 'photo.png', path: '/t/2', isDirectory: false, size: 20, mtime: new Date(), originalParent: '/home/stark/Pictures' },
    ];
    expect(filterTrashFiles(items, 'report').map((f) => f.name)).toEqual(['Report.pdf']);
    expect(filterTrashFiles(items, 'pictures').map((f) => f.name)).toEqual(['photo.png']);
    expect(filterTrashFiles(items, '').map((f) => f.name)).toEqual(['Report.pdf', 'photo.png']);
});
```

- [ ] **Step 2: Run `bun test` on the modified test files to verify they fail**

Run: `bun test src/api/__tests__/commandParity.test.ts src/api/__tests__/tauriAdapter.test.ts src/utils/__tests__/fileUtils.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement API types, command map, adapter, `FileSystemService`, and `fileUtils` helpers**

1. Update `src/types/files.ts`, `src/api/types.ts`, and `src/api/commandMap.ts` (`listTrash: 'list_trash'`, `restoreTrashItems: 'restore_trash_items'`, `purgeTrashItems: 'purge_trash_items'`, `emptyTrash: 'empty_trash'`).
2. Update `RawFileEntry`, `toIFile`, and `createTauriAdapter` in `src/api/tauriAdapter.ts` to map `trashId` (`entry.trashId ?? entry.trash_id`) and `originalParent` (`entry.originalParent ?? entry.original_parent`), and implement `listTrash`, `restoreTrashItems`, `purgeTrashItems`, and `emptyTrash`.
3. Update `src/services/FileSystemService.ts` with `listTrash`, `restoreTrash`, `purgeTrash`, and `emptyTrash`.
4. Add `formatOriginalParent` and `filterTrashFiles` in `src/utils/fileUtils.ts`.

- [ ] **Step 4: Run `bun test` to verify API and utility tests pass**

Run: `bun test src/api/__tests__/commandParity.test.ts src/api/__tests__/tauriAdapter.test.ts src/utils/__tests__/fileUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/files.ts src/api/types.ts src/api/commandMap.ts src/api/tauriAdapter.ts src/services/FileSystemService.ts src/utils/fileUtils.ts src/api/__tests__/commandParity.test.ts src/api/__tests__/tauriAdapter.test.ts src/utils/__tests__/fileUtils.test.ts
git commit -m "feat(api): wire trash commands and file utility helpers"
```

---

### Task 3: Sidebar, Omnibar, Settings Toggle & Properties Dialog Trash Support

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Omnibar.tsx`
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/components/PropertiesDialog.tsx`
- Modify: `src/components/__tests__/uiStandardization.test.tsx`

**Interfaces:**
- Consumes: `IFile.originalParent` from Task 2.
- Produces:
  - `Sidebar`: renders `NavigationDrawerItem` with `label="Trash"` and `onClick={() => onNavigate('app://trash')}` at the end of the Places section.
  - `Omnibar`: renders `Trash` label and `delete` icon when `currentPath === 'app://trash'`.
  - `SettingsDialogProps`: adds `confirmTrash?: boolean; onToggleConfirmTrash?: () => void;` and renders `"Confirm before moving to Trash"` switch in Explorer & Layout section.
  - `PropertiesDialog`: displays `Original Location` (`file.originalParent`) and `Deleted` (`file.mtime`) when `file.originalParent` is present.

- [ ] **Step 1: Write failing component tests in `src/components/__tests__/uiStandardization.test.tsx`**

Add tests in `src/components/__tests__/uiStandardization.test.tsx`:
```tsx
test('Sidebar renders Trash item in Places and marks it selected when currentPath is app://trash', () => {
    const html = renderToStaticMarkup(
        <Sidebar onNavigate={() => {}} currentPath="app://trash" collapsed={false} />
    );
    expect(html).toContain('Trash');
    expect(html).toContain('>delete<');
});

test('Omnibar displays Trash title and delete icon when currentPath is app://trash', () => {
    const html = renderToStaticMarkup(
        <Omnibar currentPath="app://trash" onNavigate={() => {}} onSearch={() => {}} />
    );
    expect(html).toContain('Trash');
    expect(html).toContain('>delete<');
});

test('SettingsDialog renders Confirm before moving to Trash switch', () => {
    const html = withMockLocalStorage(() =>
        renderToStaticMarkup(
            <AppThemeProvider>
                <SettingsDialog
                    open={true}
                    onClose={() => {}}
                    showHiddenFiles={true}
                    onToggleHiddenFiles={() => {}}
                    iconSize={64}
                    onIconSizeChange={() => {}}
                    viewMode="grid"
                    onViewModeChange={() => {}}
                    filledIcons={false}
                    onToggleFilledIcons={() => {}}
                    confirmTrash={true}
                    onToggleConfirmTrash={() => {}}
                />
            </AppThemeProvider>
        )
    );
    expect(html).toContain('Confirm before moving to Trash');
    expect(html).toContain('Ask for confirmation before moving files or folders to Trash');
});

test('PropertiesDialog shows Original Location and Deleted timestamp for trashed items', () => {
    const trashedFile = makeFile('old.txt', {
        path: '/home/stark/.local/share/Trash/files/old.txt',
        originalParent: '/home/stark/Documents',
        trashId: '/home/stark/.local/share/Trash/info/old.txt.trashinfo',
    });
    const html = renderToStaticMarkup(
        <PropertiesDialog open={true} onClose={() => {}} file={trashedFile} />
    );
    expect(html).toContain('Original Location');
    expect(html).toContain('/home/stark/Documents');
    expect(html).toContain('Deleted');
});
```

- [ ] **Step 2: Run `bun test` to verify the new tests fail**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement Trash support in `Sidebar.tsx`, `Omnibar.tsx`, `SettingsDialog.tsx`, and `PropertiesDialog.tsx`**

1. In `src/components/Sidebar.tsx`:
   - Below `{places.map(...)}` in the `Places` section (before `<NavigationDrawerDivider className="my-2" />`), render:
     ```tsx
     <NavigationDrawerItem
         key="app://trash"
         selected={normCurrent === 'app://trash'}
         shape="pill"
         icon={<Icon name="delete" size={20} />}
         activeIcon={<Icon name="delete" size={20} filled />}
         label="Trash"
         onClick={() => onNavigate('app://trash')}
     />
     ```
2. In `src/components/Omnibar.tsx`:
   - Use `const leadingIconName = isEditing ? 'search' : currentPath === 'app://trash' ? 'delete' : 'folder_open';`.
   - In non-editing mode, add branch for `currentPath === 'app://trash'`:
     ```tsx
     ) : currentPath === 'app://trash' ? (
         <span className="text-sm font-medium text-m3-on-surface truncate">
             Trash
         </span>
     ) : (
     ```
3. In `src/components/SettingsDialog.tsx`:
   - Add `confirmTrash = true` and `onToggleConfirmTrash` to `SettingsDialogProps`.
   - Under `Explorer & Layout` section, add a `Switch` row with title `"Confirm before moving to Trash"`, subtitle `"Ask for confirmation before moving files or folders to Trash"`, `checked={confirmTrash}`, `onCheckedChange={() => onToggleConfirmTrash?.()}`, and `ariaLabel="Confirm before moving to Trash"`.
4. In `src/components/PropertiesDialog.tsx`:
   - When `file.originalParent` is defined, render `"Original Location"` (`{file.originalParent}`) instead of `"Location"`, and `"Deleted"` instead of `"Modified"`.

- [ ] **Step 4: Run `bun test` to verify component tests pass**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Omnibar.tsx src/components/SettingsDialog.tsx src/components/PropertiesDialog.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "feat(ui): add Trash sidebar entry, omnibar state, settings toggle, and properties metadata"
```

---

### Task 4: `FileList` & `ExplorerTab` Trash Mode + Unified Delete / Purge Dialogs in `App.tsx`

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/FileList.tsx`
- Modify: `src/components/ExplorerTab.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/__tests__/uiStandardization.test.tsx`

**Interfaces:**
- Consumes: `FileSystemService.listTrash/restoreTrash/purgeTrash/emptyTrash`, `formatOriginalParent`, `filterTrashFiles` from Task 2; `SettingsDialog` props from Task 3.
- Produces:
  - `FileListProps`: adds `isTrash?: boolean; homePath?: string;`
  - `ExplorerTabProps`: adds:
    - `homePath?: string;`
    - `onTrashRequest?: (items: IFile[]) => void;`
    - `onRestoreRequest?: (items: IFile[]) => void;`
    - `onPurgeRequest?: (items: IFile[]) => void;`
    - `onEmptyTrashRequest?: () => void;`
  - `App.tsx`: unified Move-to-Trash confirmation dialog (respecting `settings.confirmTrash`), mandatory Permanent Delete / Empty Trash confirmation dialog, and Trash context menu items.

- [ ] **Step 1: Write failing tests for `FileList` and `ExplorerTab` in Trash mode in `src/components/__tests__/uiStandardization.test.tsx`**

Add to `src/components/__tests__/uiStandardization.test.tsx`:
```tsx
describe('Trash view in FileList and ExplorerTab', () => {
    test('FileList renders empty trash state when isTrash is true and files is empty', () => {
        const html = renderToStaticMarkup(
            <FileList
                files={[]}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons={false}
                isTrash={true}
            />
        );
        expect(html).toContain('Trash is empty');
        expect(html).toContain('Items moved to the trash will appear here.');
        expect(html).toContain('>delete_outline<');
    });

    test('FileList in list and grid view renders Original Location and Date Deleted when isTrash is true', () => {
        const trashed = [
            makeFile('report.pdf', {
                path: '/home/stark/.local/share/Trash/files/report.pdf',
                originalParent: '/home/stark/Documents/work',
                trashId: '/home/stark/.local/share/Trash/info/report.pdf.trashinfo',
            }),
        ];
        const listHtml = renderToStaticMarkup(
            <FileList
                files={trashed}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="list"
                iconSize={64}
                filledIcons={false}
                isTrash={true}
                homePath="/home/stark"
            />
        );
        expect(listHtml).toContain('Original Location');
        expect(listHtml).toContain('Date Deleted');
        expect(listHtml).toContain('~/Documents/work');

        const gridHtml = renderToStaticMarkup(
            <FileList
                files={trashed}
                selectedFiles={new Set()}
                onSelect={() => {}}
                onNavigate={() => {}}
                viewMode="grid"
                iconSize={64}
                filledIcons={false}
                isTrash={true}
                homePath="/home/stark"
            />
        );
        expect(gridHtml).toContain('~/Documents/work');
    });

    test('ExplorerTab at app://trash shows Empty Trash button and hides New Folder button', () => {
        const html = withMockLocalStorage(() =>
            renderToStaticMarkup(
                <ToastProvider>
                    <ClipboardProvider>
                        <ExplorerTab
                            tabId="trash-tab"
                            isActive={true}
                            initialPath="app://trash"
                            onPathChange={() => {}}
                            onContextMenu={() => {}}
                            onCreateFolderRequest={() => {}}
                            onEmptyTrashRequest={() => {}}
                            showHiddenFiles={true}
                            iconSize={64}
                            viewMode="list"
                            filledIcons={false}
                        />
                    </ClipboardProvider>
                </ToastProvider>
            )
        );
        expect(html).toContain('Empty Trash');
        expect(html).not.toContain('aria-label="New Folder"');
    });
});
```

- [ ] **Step 2: Run `bun test` to verify the new tests fail**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement Trash mode in `src/index.css`, `src/components/FileList.tsx`, `src/components/ExplorerTab.tsx`, and `src/App.tsx`**

1. In `src/index.css`, add `.file-meta-grid-trash` layout rules alongside `.file-meta-grid`:
   ```css
   .file-meta-grid-trash {
     display: grid;
     grid-template-columns: 5.5rem;
     gap: 0.75rem;
     align-items: center;
   }

   @media (min-width: 640px) {
     .file-meta-grid-trash {
       grid-template-columns: 8.5rem 5.5rem;
     }
   }

   @media (min-width: 768px) {
     .file-meta-grid-trash {
       grid-template-columns: 10rem 9.5rem 5.5rem;
     }
   }

   @media (min-width: 1024px) {
     .file-meta-grid-trash {
       grid-template-columns: 12rem 9.5rem 6.5rem 5.5rem;
     }
   }
   ```
2. In `src/components/FileList.tsx`:
   - Accept `isTrash = false` and `homePath` in `FileListProps` and pass `isTrash` and `homePath` to `FileListRow`.
   - When `files.length === 0` and `isTrash && !isSearch`, render `<Icon name="delete_outline" size={42} />`, title `"Trash is empty"`, and subtitle `"Items moved to the trash will appear here."`.
   - In `FileListRow`, disable drag when `isTrash` (`draggable={!isTrash}`), and when `isTrash` is true, render `trailingContent` with `.file-meta-grid-trash`:
     - `<span className="hidden sm:block truncate" title={file.originalParent}>{formatOriginalParent(file.originalParent, homePath)}</span>`
     - `<span className="hidden md:block truncate">{formatFileDate(file.mtime)}</span>`
     - `<span className="hidden lg:block truncate">{fileGroupLabel}</span>`
     - `<span className="text-right tabular-nums">{file.isDirectory ? '—' : formatFileSize(file.size)}</span>`
   - In List header when `isTrash` is true, use `.file-meta-grid-trash`, show `<span className="hidden sm:flex items-center truncate">Original Location</span>`, change `"Date Modified"` to `"Date Deleted"`, and hide `"Type"` below `lg` (`hidden lg:flex`).
   - In Grid view cards when `isTrash` is true, disable drag (`draggable={!isTrash}`) and render `<span className="text-[11px] text-m3-on-surface-variant mt-0.5 truncate max-w-full px-1" title={file.originalParent}>{formatOriginalParent(file.originalParent, homePath)}</span>`.
3. In `src/components/ExplorerTab.tsx`:
   - Compute `const isTrash = currentPath === 'app://trash';`.
   - Skip `app://trash` in `addToRecents`.
   - In `loadPath` and `reloadSilently`: when `path === 'app://trash'`, call `await FileSystemService.listTrash()` instead of `FileSystemService.listDir(path)`.
   - In `handleSearch`: when `isTrash` is true, call `const allTrash = await FileSystemService.listTrash(); setFiles(filterTrashFiles(allTrash, query));` instead of `api.search(...)`.
   - In `handleNavigate(file)`: when `isTrash` is true, call `showToast('Restore item from Trash to open it', 'info')` and return without opening or navigating.
   - In keyboard shortcuts (`handleKeyDown`):
     - Disable `Ctrl+Shift+N`, `Ctrl+C`, `Ctrl+X`, `Ctrl+V` when `isTrash` is true.
     - On `Delete` key when `selectedItems.length > 0`: if `isTrash`, call `onPurgeRequest?.(selectedItems)`; otherwise if `onTrashRequest` is provided, call `onTrashRequest(selectedItems)` (with fallback to `FileSystemService.trash` if `onTrashRequest` is omitted). Never call `window.confirm`.
   - In top toolbar:
     - Hide `New Folder` button when `isTrash` is true; disable `Up` button when `isTrash` is true.
     - When `isTrash` is true, render an **Empty Trash** button (`Button` with `variant="default"`, `colorStyle="tonal"`, `size="sm"`, `disabled={files.length === 0}`, `onClick={() => onEmptyTrashRequest?.()}`, `aria-label="Empty Trash"`): `<Icon name="delete_forever" size={18} /><span>Empty Trash</span>`.
   - In Floating Selection Toolbar (`HorizontalFloatingToolbar`):
     - When `isTrash` is true, render Quick Look (if 1 item selected), **Restore** (`ToolbarIconButton` with icon `restore_from_trash`, `aria-label="Restore"`, `title="Restore"`, `onClick={() => onRestoreRequest?.(selectedItems)}`), and **Delete Permanently** (`ToolbarIconButton` with icon `delete_forever`, `aria-label="Delete Permanently"`, `title="Delete Permanently (Del)"`, `onClick={() => onPurgeRequest?.(selectedItems)}`).
     - When `isTrash` is false, the `Move to Trash` button calls `onTrashRequest ? onTrashRequest(selectedItems) : ...`.
4. In `src/App.tsx`:
   - Add `const [confirmTrash, setConfirmTrash] = useLocalStorage<boolean>('settings.confirmTrash', true);`.
   - Add state for:
     - `trashConfirmItems: IFile[] | null` (for Move to Trash dialog when `confirmTrash` is `true`)
     - `purgeConfirmState: { mode: 'items'; items: IFile[] } | { mode: 'empty' } | null` (for Permanent Delete / Empty Trash dialog, always shown)
   - Implement `executeTrashItems(items: IFile[])`, `handleTrashRequest(items: IFile[])`, `handleRestoreRequest(items: IFile[])`, `handlePurgeRequest(items: IFile[])`, and `handleEmptyTrashRequest()`.
   - When a tab's `path === 'app://trash'`, set tab `title` to `'Trash'`.
   - When `currentPath === 'app://trash'`, build context menu items:
     - On item right-click: `Restore${selectionSuffix}` (`restore_from_trash`), `Delete Permanently${selectionSuffix}` (`delete_forever`), divider, `Properties` (`info`).
     - On background right-click: `Empty Trash` (`delete_forever`).
   - Outside `app://trash`, wire Context Menu `Delete${selectionSuffix}` to `handleTrashRequest(targetItems)`.
   - Render the two M3 `Dialog` modals (`Move to Trash?` and `Delete Permanently?` / `Empty Trash?`) and pass `confirmTrash` and `onToggleConfirmTrash` to `SettingsDialog`.

- [ ] **Step 4: Run full test suite (`bun test`, `cargo test`, and `npm run build:web`)**

Run: `bun test && cargo test --manifest-path src-tauri/Cargo.toml && npm run build:web`
Expected: All unit/component tests PASS and TypeScript/Vite build succeeds with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/components/FileList.tsx src/components/ExplorerTab.tsx src/App.tsx src/components/__tests__/uiStandardization.test.tsx
git commit -m "feat(trash): integrate app://trash explorer view and unified confirmation dialogs"
```
