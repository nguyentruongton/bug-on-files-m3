# Trash Management & Unified Delete Confirmation Design

**Date:** 2026-11-14  
**Status:** Draft (Pending Approval)

---

## 1. Intent and the Why

Currently, when a user deletes files or folders in Materials (via the `Delete` key, Context Menu, or Floating Toolbar), the backend moves those items into the operating system's Trash (`trash::delete` in Tauri / `shell.trashItem` in Electron). However:
1. **Inconsistent feedback & confirmation:** Pressing `Delete` in `ExplorerTab` triggers a native browser `window.confirm("Delete X items?")` and toasts `"Deleted X items"`, whereas deleting from the Context Menu or Floating Toolbar skips confirmation and toasts `"Moved X item(s) to Trash"`. This leaves the user unsure whether their files were permanently destroyed or moved to Trash.
2. **No way to inspect or manage Trash:** There is no Trash entry in the Sidebar or UI to inspect deleted items, see where they came from or when they were deleted, restore them, or permanently purge them.

This project makes deletion behavior transparent and consistent across the entire app, adds a user-configurable M3 confirmation dialog before moving items to Trash (enabled by default), and provides a full-featured **Trash (`app://trash`)** view integrated into the existing Explorer workflow.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Browse Trash (`app://trash`):** Allow users to open Trash from the Places Sidebar, inspect all trashed files and folders in both Grid and List views, and see each item's **Original Location** and **Date Deleted**.
- **Restore from Trash:** Allow restoring one or multiple selected items back to their original location. Automatically recreate missing parent directories and automatically rename restored items on name collision (`<stem> (restored)<ext>`, `<stem> (restored 2)<ext>`, etc.).
- **Permanent Delete & Empty Trash:** Allow permanently deleting selected items in Trash (`Delete Permanently`) or purging the entire Trash (`Empty Trash`), always guarded by an explicit M3 confirmation dialog.
- **Unified Move-to-Trash Confirmation & Settings Toggle:** Replace `window.confirm` with an M3 Expressive `Dialog` across all delete entry points (`Delete` key, Context Menu, Floating Toolbar). Add a **"Confirm before moving to Trash"** setting in `SettingsDialog` (stored in `localStorage` under `settings.confirmTrash`, defaulting to `true`).

### Non-Goals
- **Navigating inside trashed directories:** Double-clicking a folder inside `app://trash` will not navigate into its subfolders (standard desktop file manager behavior on Linux/GNOME Files; folders must be restored before browsing/editing their contents).
- **In-place editing or opening of trashed files:** Users cannot rename, extract, or launch external apps on files while they are inside Trash (QuickLook preview via `Space` remains supported for convenient inspection before restoring or purging).
- **Undo toast stack:** We do not build a custom in-memory undo stack; users recover trashed files directly from `app://trash`.

### Anti-Goals
- **Silent permanent data loss:** Never permanently delete items from Trash without an explicit confirmation dialog, even if `settings.confirmTrash` is turned off.
- **Native browser blocking dialogs:** Never use `window.confirm` or `window.alert`.
- **Duplicated list/selection UI:** Do not build a separate table component that loses M3 Expressive shapes, virtual scrolling, keyboard navigation, or multi-selection.

---

## 3. Constraints

- **Platform & Backend:** Primary backend is Rust/Tauri (`src-tauri`) on Linux (FreeDesktop.org Trash specification v1.0 via crate `trash = "5.3.0"`, `trash::os_limited`). The TypeScript API layer (`IApi`) and `electron` adapter/main must remain type-compatible so `tsc -b` and existing tests continue to pass.
- **Virtualized Row Height:** `FileList.tsx` uses `useVirtualWindow` with fixed row heights (`FILE_ROW_HEIGHT = 56`, `HEADER_ROW_HEIGHT_WITH_GAP = 38`). Trash rows in List view must preserve the `h-14` (56px) row height.
- **M3 Expressive Design System:** Must use `@bug-on/m3-expressive` components (`Dialog`, `Button`, `Switch`, `HorizontalFloatingToolbar`, `ToolbarIconButton`, `NavigationDrawerItem`) and existing Material Symbols icons.

---

## 4. Approaches Considered

### Approach 1: Virtual URI `app://trash` Integrated into `ExplorerTab` & `FileList` *(Selected)*
- **How it works:** Treat `app://trash` as a virtual path in `ExplorerTab`. Extend `IFile` with optional `trashId?: string` and `originalParent?: string`. Map `mtime` to the deletion timestamp (`time_deleted`) and `path` to the actual on-disk path inside the trash `files/` directory (so thumbnails and QuickLook continue to work seamlessly). Pass `isTrash={currentPath === 'app://trash'}` to `FileList` to adjust column headers (`Original Location`, `Date Deleted`) and empty-state copy, and swap the top bar, Floating Toolbar, and Context Menu actions when `isTrash` is active.
- **Trade-offs:** Adds an `isTrash` mode branch to `ExplorerTab`, `FileList`, and `App` context menus, in exchange for 100% reuse of virtual scrolling, Grid/List switching, sorting, category grouping, multi-selection, thumbnails, and QuickLook.

### Approach 2: Standalone `<TrashView />` Component (like `<Dashboard />`)
- **How it works:** Render a separate component when `currentPath === 'app://trash'` with its own selection state, toolbar, and list rendering.
- **Trade-offs:** Keeps `FileList` untouched, but forces duplicating or degrading multi-select (`Ctrl`/`Shift`/`Ctrl+A`), virtual scrolling, Grid/List view modes, sorting, and QuickLook integration.

**Why Approach 1 was chosen:** The user selected Approach 1 because Trash is fundamentally a directory listing of files and folders with two extra metadata fields (`trashId`, `originalParent`) and specialized actions (`Restore`, `Delete Permanently`, `Empty Trash`). Reusing `ExplorerTab` and `FileList` ensures complete visual and behavioral consistency.

---

## 5. User Decisions

1. **Core Trash Capabilities:** Users can open Trash to view deleted files and folders, restore selected items, permanently delete selected items, and empty the entire Trash.
2. **Configurable Delete Confirmation:** Moving items to Trash shows a confirmation dialog by default, controlled by a toggle in **Settings** (`settings.confirmTrash`, default `true`).
3. **Architecture:** Use **Approach 1** (`app://trash` integrated into `ExplorerTab` and `FileList`).
4. **Restore Conflict & Missing Parent Handling:** When restoring an item whose original parent folder no longer exists, automatically recreate the parent folder (`create_dir_all`). When an item with the same name already exists at the destination, automatically rename the restored item (e.g. `report (restored).pdf`, `report (restored 2).pdf`) without prompting.

---

## 6. Detailed Technical Design

### 6.1 Backend: Rust / Tauri (`src-tauri`)

#### Data Model (`src-tauri/src/fs_ops.rs`)
Extend `FileEntry` with optional trash metadata fields (skipped during serialization when `None` so normal `list_dir` payloads are unchanged):

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub mtime_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trash_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_parent: Option<String>,
}
```

#### Trash Operations (`src-tauri/src/fs_ops.rs` & `src-tauri/src/commands/fs.rs`)
Implement four functions in `fs_ops` and expose them as Tauri commands in `commands::fs` (and register in `src-tauri/src/lib.rs`):

1. **`list_trash() -> Result<Vec<FileEntry>, String>`**
   - Calls `trash::os_limited::list()`.
   - For each `TrashItem`:
     - `trash_id`: `item.id.to_string_lossy().into_owned()` (on Linux FreeDesktop, `item.id` is the absolute path to `<trash_dir>/info/<name>.trashinfo`).
     - Resolves the actual trashed payload path in `<trash_dir>/files/<stem>` from `item.id` (matching FreeDesktop spec: parent of `info/` -> `files/<file_stem_of_trashinfo>`). If that path exists, uses it as `FileEntry.path` (enabling `sniff_ts_media_kind`, thumbnails, and QuickLook); otherwise falls back to `item.original_path().to_string_lossy().into_owned()`.
     - Calls `trash::os_limited::metadata(&item)` to determine `is_directory` (`matches!(meta.size, TrashItemSize::Entries(_))`) and `size` (`meta.size.size().unwrap_or(0)`).
     - `mtime_ms`: `if item.time_deleted > 0 { (item.time_deleted as u64) * 1000 } else { 0 }`.
     - `original_parent`: `item.original_parent.to_string_lossy().into_owned()`.
   - Sorts by `mtime_ms` descending (newest deleted first) as initial order, with `name` ascending as tie-breaker.

2. **`restore_trash_items(ids: Vec<String>) -> Result<bool, String>`**
   - Calls `trash::os_limited::list()` and filters items whose `id.to_string_lossy()` is in `ids`.
   - For each matching `TrashItem` (processed one by one so collisions among restored twins or existing files are both handled cleanly):
     - Ensures `std::fs::create_dir_all(&item.original_parent)` succeeds.
     - Computes a non-colliding target file name in `item.original_parent` using `resolve_non_colliding_restore_name(&item.original_parent, &item.name, is_dir)`:
       - If `<original_parent>/<name>` does not exist (`symlink_metadata().is_err()`), keeps `<name>`.
       - Otherwise splits `<name>` into `(stem, ext)` (for directories or dotfiles without extension, `stem = name, ext = ""`; for compound extensions like `.tar.gz`, or standard `.ext`, splits at the last dot unless leading dot):
         - Candidate 1: `<stem> (restored)<ext>`
         - Candidate $k \ge 2$: `<stem> (restored k)<ext>`
       - Mutates `item.name = OsString::from(resolved_name)` and calls `trash::os_limited::restore_all(vec![item])`.

3. **`purge_trash_items(ids: Vec<String>) -> Result<bool, String>`**
   - Calls `trash::os_limited::list()`, filters items whose `id.to_string_lossy()` is in `ids`, and passes them to `trash::os_limited::purge_all(matching)`.

4. **`empty_trash() -> Result<bool, String>`**
   - Calls `trash::os_limited::list()` and passes all items to `trash::os_limited::purge_all(all_items)`.

*(Designer Call: In `electron/main.ts` and `electron/preload.ts`, add matching IPC handlers `fs:list-trash`, `fs:restore-trash`, `fs:purge-trash`, `fs:empty-trash` operating on `~/.local/share/Trash` so the Electron target remains functional and type-safe.)*

---

### 6.2 Frontend API & Service Layer

- **`src/types/files.ts`:**
  ```ts
  export interface IFile {
      name: string;
      path: string;
      isDirectory: boolean;
      size: number;
      mtime: Date;
      mediaKind?: 'video';
      trashId?: string;
      originalParent?: string;
  }
  ```
- **`src/api/types.ts` & `src/api/commandMap.ts` & `src/api/tauriAdapter.ts`:**
  - Add to `IApi`:
    - `listTrash: () => Promise<IFile[]>` (`list_trash`)
    - `restoreTrashItems: (ids: string[]) => Promise<boolean>` (`restore_trash_items`)
    - `purgeTrashItems: (ids: string[]) => Promise<boolean>` (`purge_trash_items`)
    - `emptyTrash: () => Promise<boolean>` (`empty_trash`)
  - In `tauriAdapter.ts`, `toIFile` maps `trashId` (`entry.trashId ?? entry.trash_id`) and `originalParent` (`entry.originalParent ?? entry.original_parent`).
  - Note on selection keys inside `app://trash`: Because two trashed items could theoretically have had the same original path or different `.trashinfo` files, each item in `~/.local/share/Trash/files/<unique_name>` already has a unique `path` on disk! When `trash_id` is mapped, `FileEntry.path` is the unique path in `Trash/files/...` (or if missing, `trash_id`), guaranteeing `file.path` is always unique per trashed entry for `selectedFiles: Set<string>`.
- **`src/services/FileSystemService.ts`:**
  - Add `listTrash()`, `restoreTrash(ids: string[])`, `purgeTrash(ids: string[])`, and `emptyTrash()`.

---

### 6.3 Sidebar, Omnibar, and Navigation (`app://trash`)

- **`src/components/Sidebar.tsx`:**
  - Below the `places.map(...)` items inside the **Places** section, render a `NavigationDrawerItem` for **Trash**:
    - `selected={normCurrent === 'app://trash'}`
    - `icon={<Icon name="delete" size={20} />}`
    - `activeIcon={<Icon name="delete" size={20} filled />}`
    - `label="Trash"`
    - `onClick={() => onNavigate('app://trash')}`
- **`src/components/Omnibar.tsx`:**
  - When `currentPath === 'app://trash'`, display `<Icon name="delete" ... />` (or `folder_open`) and the label `"Trash"` (similar to `"Home Dashboard"` for `app://dashboard`).
- **`src/App.tsx`:**
  - Tab title resolution: when `path === 'app://trash'`, tab title is `'Trash'`.
  - `addToRecents` in `ExplorerTab.tsx`: skip `'app://trash'` just like `'app://dashboard'`.

---

### 6.4 Trash Mode in `ExplorerTab.tsx` & `FileList.tsx`

- **Loading & Refreshing (`ExplorerTab.tsx`):**
  - Define `const isTrash = currentPath === 'app://trash';`.
  - In `loadPath` and `reloadSilently`: when `path === 'app://trash'`, call `FileSystemService.listTrash()` instead of `FileSystemService.listDir(path)`.
  - Default sort when entering `app://trash`: Designer call — keep user's sort controls active, or allow sorting by `name`, `date` (Date Deleted), `type`, `size`.
  - **Search inside Trash:** When `handleSearch(query)` is triggered while `isTrash` is true, filter the trashed items client-side by matching `query` (case-insensitive) against `file.name` or `file.originalParent` instead of invoking backend `find` on `app://trash`.
- **Top Toolbar in `ExplorerTab.tsx`:**
  - Hide the `New Folder` button when `isTrash` is true.
  - Show an **Empty Trash** button (`Button` with `variant="default"`, `colorStyle="tonal"`, `size="sm"`, icon `delete_forever`, label `"Empty Trash"`, disabled when `files.length === 0`) in the top toolbar action area when `isTrash` is true.
- **Item Navigation & Drag/Drop in `ExplorerTab.tsx`:**
  - `handleNavigate(file)` when `isTrash` is true: do not open external apps or navigate into trashed directories (no-op on double-click, or show an informational toast `"Restore item to open it"`). QuickLook (`Space`) still works on trashed files.
  - Disable file drop import (`onDrop`) and item drag start (`draggable={!isTrash}`) when `isTrash` is true.
- **Floating Selection Toolbar (`ExplorerTab.tsx`) when `isTrash` is true:**
  - Replace normal file actions with:
    - If `selectedItems.length === 1`: **Quick Look** (`visibility`, `Space`).
    - **Restore** (`ToolbarIconButton` with icon `restore_from_trash`, `aria-label="Restore"`, `title="Restore"`, calls `onRestoreRequest(selectedItems)`).
    - **Delete Permanently** (`ToolbarIconButton` with icon `delete_forever`, `aria-label="Delete Permanently"`, `title="Delete Permanently (Del)"`, calls `onPurgeRequest(selectedItems)`).
- **Context Menu (`App.tsx`) when `currentPath === 'app://trash'`:**
  - On item right-click:
    - `Restore${selectionSuffix}` (icon: `restore_from_trash`) -> restores target items and toasts `"Restored X item(s)"`.
    - `Delete Permanently${selectionSuffix}` (icon: `delete_forever`) -> opens Permanent Delete Confirmation Dialog.
    - `Properties` (icon: `info`) -> opens `PropertiesDialog`.
  - On background right-click inside Trash:
    - `Empty Trash` (icon: `delete_forever`, disabled/hidden if Trash is empty) -> opens Empty Trash Confirmation Dialog.
- **`FileList.tsx` (`isTrash?: boolean` prop):**
  - **Empty State:** When `isTrash && files.length === 0`, show icon `delete_outline`, title `"Trash is empty"`, subtitle `"Items moved to the trash will appear here."`.
  - **List View Header & Rows:**
    - Header column label changes from `"Date Modified"` to `"Date Deleted"`.
    - Add an `"Original Location"` column in `.file-meta-grid-trash` (displayed on `lg` screens before `Date Deleted`, and also shown as a truncated path in `title` tooltip).
  - **Grid View Cards:**
    - Below `file.name`, display `file.originalParent` (with home prefix shortened to `~`, truncated to 1 line) in `text-[11px] text-m3-on-surface-variant`.

---

### 6.5 Unified Delete Confirmation & Settings Toggle

- **Setting State (`App.tsx` & `SettingsDialog.tsx`):**
  - Add `const [confirmTrash, setConfirmTrash] = useLocalStorage<boolean>('settings.confirmTrash', true);` in `App.tsx`.
  - Pass `confirmTrash` and `onToggleConfirmTrash={() => setConfirmTrash(!confirmTrash)}` to `SettingsDialog`.
  - In `SettingsDialog` under **Explorer & Layout**, add a `Switch` row:
    - Title: `"Confirm before moving to Trash"`
    - Subtitle: `"Ask for confirmation before moving files or folders to Trash"`
- **Centralized Delete / Purge Dialogs (`App.tsx`):**
  - Expose callbacks from `App.tsx` to `ExplorerTab`:
    - `onTrashRequest: (items: IFile[]) => void`
    - `onRestoreRequest: (items: IFile[]) => void`
    - `onPurgeRequest: (items: IFile[]) => void`
    - `onEmptyTrashRequest: () => void`
  - **Move to Trash flow (`onTrashRequest`):**
    - Used by `Delete` key (outside Trash), Context Menu `Delete`, and Floating Toolbar `Move to Trash`.
    - If `confirmTrash` is `true`, open the M3 `Dialog` (`title="Move to Trash?"`, icon `delete`):
      - Body: `"Move "${items[0].name}" to the Trash?"` (for 1 item) or `"Move ${items.length} selected items to the Trash? You can restore them later from Trash."`
      - Actions: `Cancel` (text button) and `Move to Trash` (filled button).
    - If `confirmTrash` is `false`, immediately execute `FileSystemService.trash(...)` for each item, toast `"Moved X item(s) to Trash"`, and refresh the active tab.
  - **Permanent Delete / Empty Trash flow (`onPurgeRequest` & `onEmptyTrashRequest`):**
    - Used by `Delete` key inside `app://trash`, Context Menu `Delete Permanently` / `Empty Trash`, Floating Toolbar `Delete Permanently`, and Top Bar `Empty Trash`.
    - **Always** opens the M3 `Dialog` (`title="Delete Permanently?"` or `"Empty Trash?"`, icon `delete_forever`):
      - Body: `"Permanently delete ${count} item(s) from Trash? This action cannot be undone."` (or `"Permanently delete all items in the Trash? This action cannot be undone."`).
      - Actions: `Cancel` (text button) and `Delete Permanently` / `Empty Trash` (filled button).

---

## 7. What's Left to the Builder

- Exact CSS grid template widths for `.file-meta-grid-trash` in `src/index.css` so columns align cleanly across responsive breakpoints while keeping row height at `56px`.
- Helper function `formatOriginalParent(path: string, homePath?: string)` to display `/home/<user>/...` concisely as `~/...` in Trash rows/cards.
- Unit and component tests across Rust (`fs_ops` / `commands::fs` trash tests using isolated `XDG_DATA_HOME` tempdirs) and Vitest (`ExplorerTab`, `FileList`, `SettingsDialog`, `App` trash & confirmation flows).
