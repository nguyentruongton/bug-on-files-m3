# UI & UX Refinements (7 Improvements) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver 7 targeted UI/UX and backend improvements: default new tabs to `app://dashboard`, stream determinate archive extraction progress with a wavy `ProgressIndicator`, fix clipped `TextField` labels in `Dialog`, convert toolbar `ButtonGroup` clusters to standalone `IconButton`s, add `animateFill` + `fill={1}` to active/selected icons, refactor `ContextMenu` to `@bug-on/m3-expressive` `VerticalMenu`, and fix `themeMode === 'system'` detection on Linux desktops.

**Architecture:** We extend the Rust and Electron extraction backends to count entries and stream stdout line progress over the `'fs:extract-progress'` IPC channel, surfaced through `api.onExtractProgress` and rendered in `ExplorerTab` with `@bug-on/m3-expressive`'s wavy `ProgressIndicator`. On the frontend, we enhance `Icon` with `motion/react` `fontVariationSettings` animation, replace `ContextMenu`'s custom markup with `VerticalMenu`/`VerticalMenuGroup`/`MenuItem`, replace `ExplorerTab`'s `ButtonGroup`s with standalone tonal `IconButton`s, add `pt-2` clearance in `DialogBody`, and resolve `'system'` theme mode from Caelestia/Matugen/GTK theme files before falling back to `matchMedia`.

**Tech Stack:** React 19, TypeScript, `@bug-on/m3-expressive`, `motion/react`, Tailwind CSS v4, Tauri v2 (Rust), Electron, Bun test, Cargo test.

**Spec:** `docs/superpowers/specs/2026-11-14-ui-and-ux-refinements-design.md`

## Global Constraints

- Do NOT modify any files inside `node_modules/@bug-on/m3-expressive`.
- Keep Tauri `COMMAND_MAP` at exactly 37 commands (`extract_file` remains the command name; `'fs:extract-progress'` is an event stream via `onExtractProgress`).
- Maintain backward compatibility for `Icon`'s `filled?: boolean` prop while adding `fill?: 0 | 1` and `animateFill?: boolean`.
- Ensure SSR (`renderToStaticMarkup`) compatibility across all updated components so `bun test` unit tests run deterministically without a DOM window.

## Review Focus

- `unzip` stdout header/summary lines (`Archive: ...`, `caution: ...`) must not be counted as extracted files by `parse_extracted_entry_line`.
- Archives with 0 countable entries or failed `list_entries_command` must fall back to indeterminate wavy `ProgressIndicator` (`percent: undefined`) rather than dividing by zero (`NaN`).
- Consecutive or leading/trailing `divider: true` items in `ContextMenu` must not produce empty `<VerticalMenuGroup>` elements.
- Caelestia `scheme.json` files without an explicit `"mode"` field must still resolve `'light'` or `'dark'` from `colours.surface` / `colours.background` hex luminance.
- When `themeMode === 'system'` is active, `AppThemeContext` must still expose `themeMode === 'system'` to consumers (`SettingsDialog`) while passing the resolved `'light' | 'dark'` mode to `MD3ThemeProvider`.

---

### Task 1: System Theme Mode Detection (`themeUtils.ts` & `AppThemeContext.tsx`)

**Files:**
- Modify: `src/utils/themeUtils.ts`
- Modify: `src/contexts/AppThemeContext.tsx`
- Test: `src/utils/__tests__/themeUtils.test.ts`

**Interfaces:**
- Produces: `extractSystemThemeMode(cssText: string | null | undefined): 'light' | 'dark' | null` in `src/utils/themeUtils.ts`

- [ ] **Step 1: Write the failing tests in `src/utils/__tests__/themeUtils.test.ts`**

Add tests for `extractSystemThemeMode`:
```ts
describe('extractSystemThemeMode', () => {
    it('returns light or dark from Caelestia scheme.json mode field', () => {
        expect(extractSystemThemeMode('{"mode":"light","colours":{"primary":"8f4a4c"}}')).toBe('light');
        expect(extractSystemThemeMode('{"mode":"dark","colours":{"primary":"ffb3b4"}}')).toBe('dark');
    });

    it('falls back to surface/background luminance in Caelestia JSON when mode is omitted', () => {
        expect(extractSystemThemeMode('{"colours":{"surface":"fff8f7"}}')).toBe('light');
        expect(extractSystemThemeMode('{"colours":{"surface":"1a1111"}}')).toBe('dark');
    });

    it('detects light or dark from Matugen CSS --md-sys-color-surface or --md-sys-color-background', () => {
        expect(extractSystemThemeMode(':root { --md-sys-color-surface: #fff8f7; }')).toBe('light');
        expect(extractSystemThemeMode(':root { --md-sys-color-background: #141218; }')).toBe('dark');
    });

    it('detects light or dark from GTK @define-color window_bg_color / view_bg_color', () => {
        expect(extractSystemThemeMode('@define-color window_bg_color #fafafa;')).toBe('light');
        expect(extractSystemThemeMode('@define-color view_bg_color #1e1e2e;')).toBe('dark');
    });

    it('returns null for empty or unrecognized input', () => {
        expect(extractSystemThemeMode(null)).toBeNull();
        expect(extractSystemThemeMode('')).toBeNull();
        expect(extractSystemThemeMode('body { color: red; }')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/__tests__/themeUtils.test.ts`
Expected: FAIL (`extractSystemThemeMode` is not exported from `../themeUtils`).

- [ ] **Step 3: Implement `extractSystemThemeMode` in `src/utils/themeUtils.ts` and wire `AppThemeContext.tsx`**

In `src/utils/themeUtils.ts`:
- Implement helper `hexLuminance(hex: string): number` that strips `#`, parses R/G/B (`0..255`), and returns `(0.2126 * r + 0.7152 * g + 0.0722 * b) / 255`.
- Implement `extractSystemThemeMode(cssText: string | null | undefined): 'light' | 'dark' | null`:
  - If JSON (`trimmed.startsWith('{')`), check `parsed.mode === 'light' | 'dark'`, then check hex luminance (`> 0.5 ? 'light' : 'dark'`) on `parsed.colours?.surface ?? parsed.colours?.background ?? parsed.surface ?? parsed.background`.
  - Otherwise match `--md-sys-color-(?:surface|background)\s*:\s*(#[0-9a-fA-F]{6})\b` or `@define-color\s+(?:window_bg_color|view_bg_color)\s+(#[0-9a-fA-F]{6})\b` and return `hexLuminance(match[1]) > 0.5 ? 'light' : 'dark'`.

In `src/contexts/AppThemeContext.tsx`:
- Add `detectedSystemMode: 'light' | 'dark' | null` state and `mediaQueryDark: boolean` state.
- Poll `ThemeService.getMatugenCss()` on mount and every `2000ms` whenever `useMatugen || themeMode === 'system'`. Update `detectedSystemMode` via `extractSystemThemeMode(rawCss)` (and only update `matugenSeed` when `useMatugen` is true).
- Compute `resolvedMode: 'light' | 'dark' = themeMode === 'system' ? (detectedSystemMode ?? (mediaQueryDark ? 'dark' : 'light')) : themeMode`.
- Pass `initialMode={resolvedMode}` to `MD3ThemeProvider`, sync `setMode(resolvedMode)` in `ThemeProviderSync`, and use `resolvedMode === 'dark'` for `api.setIcon`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/__tests__/themeUtils.test.ts`
Expected: PASS.

---

### Task 2: Backend & IPC Streaming Archive Extraction Progress

**Files:**
- Modify: `src-tauri/src/extract.rs`
- Modify: `src-tauri/src/commands/app.rs`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/api/types.ts`
- Modify: `src/api/tauriAdapter.ts`
- Test: `src-tauri/src/extract.rs`
- Test: `src-tauri/src/commands/app.rs`
- Test: `src/api/__tests__/tauriAdapter.test.ts`

**Interfaces:**
- Produces:
  - Rust: `ExtractProgressPayload { path: String, archive_name: String, current_file: String, extracted_count: usize, total_count: usize, percent: Option<f64>, done: bool, error: Option<String> }` (`#[serde(rename_all = "camelCase")]`) and `extract_file_with_progress<F: FnMut(ExtractProgressPayload)>(file: &str, on_progress: F) -> Result<bool, String>` in `src-tauri/src/extract.rs`
  - TS (`src/api/types.ts`):
    ```ts
    export interface ExtractProgressEvent {
        path: string;
        archiveName: string;
        currentFile: string;
        extractedCount: number;
        totalCount: number;
        percent?: number;
        done: boolean;
        error?: string;
    }
    ```
    and `onExtractProgress: (cb: (e: ExtractProgressEvent) => void) => () => void` on `IApi`.

- [ ] **Step 1: Write failing Rust and TypeScript adapter tests**

In `src-tauri/src/extract.rs` tests:
```rust
#[test]
fn test_parse_extracted_entry_line_unzip_and_tar() {
    assert_eq!(parse_extracted_entry_line("unzip", "Archive:  /tmp/test.zip"), None);
    assert_eq!(
        parse_extracted_entry_line("unzip", "  inflating: folder/file.txt  "),
        Some("folder/file.txt".to_string())
    );
    assert_eq!(
        parse_extracted_entry_line("unzip", "   creating: folder/"),
        Some("folder/".to_string())
    );
    assert_eq!(
        parse_extracted_entry_line("tar", "folder/file.txt\n"),
        Some("folder/file.txt".to_string())
    );
}
```
In `src-tauri/src/commands/app.rs` tests, update `test_extract_file_tar_success` to call `crate::extract::extract_file_with_progress` and assert that progress events are emitted with `total_count == 1`, `extracted_count == 1`, and final `done == true`.

In `src/api/__tests__/tauriAdapter.test.ts`:
```ts
test('onExtractProgress subscribes to fs:extract-progress and forwards payload', async () => {
    let subscribedEvent = '';
    let received: unknown = null;
    let registeredCb: ((payload: unknown) => void) | null = null;

    const listen = async (event: string, cb: (payload: unknown) => void) => {
        subscribedEvent = event;
        registeredCb = cb;
        return () => {};
    };
    const adapter = createTauriAdapter(async () => {}, listen);

    adapter.onExtractProgress((e) => {
        received = e;
    });

    expect(subscribedEvent).toBe('fs:extract-progress');
    const sample = {
        path: '/tmp/a.zip',
        archiveName: 'a.zip',
        currentFile: 'hello.txt',
        extractedCount: 1,
        totalCount: 2,
        percent: 50,
        done: false,
    };
    registeredCb!(sample);
    expect(received).toEqual(sample);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && bun test src/api/__tests__/tauriAdapter.test.ts`
Expected: FAIL (`parse_extracted_entry_line`, `extract_file_with_progress`, and `onExtractProgress` are not defined).

- [ ] **Step 3: Implement extraction progress in Rust, Electron, and `tauriAdapter.ts`**

1. In `src-tauri/src/extract.rs`:
   - Define `ExtractProgressPayload` (`#[derive(Debug, Clone, serde::Serialize, PartialEq)]`, `#[serde(rename_all = "camelCase")]`).
   - Add `list_entries_command(file: &str) -> Option<(String, Vec<String>)>` (`unzip -Z1 <file>` for `.zip`, `tar -tf <file>` for `.tar/.gz/.xz/.tgz`).
   - Add `extract_verbose_command(file: &str) -> Option<(String, Vec<String>)>` (`unzip -o <file> -d <dir>` for `.zip`, `tar -xvf <file> -C <dir>` for `.tar/.gz/.xz/.tgz`).
   - Add `parse_extracted_entry_line(cmd: &str, line: &str) -> Option<String>`.
   - Add `extract_file_with_progress<F: FnMut(ExtractProgressPayload)>(file: &str, mut on_progress: F) -> Result<bool, String>` that counts entries, spawns verbose extract with piped stdout, throttles intermediate progress callbacks to 40ms intervals, and always emits the initial (`0%`) and final (`done: true`) events.
2. In `src-tauri/src/commands/app.rs`:
   - Update `extract_file` to `pub async fn extract_file(app: tauri::AppHandle, path: String) -> Result<bool, String>` using `tokio::task::spawn_blocking` and `tauri::Emitter::emit(&app, "fs:extract-progress", payload)`.
3. In `electron/main.ts` and `electron/preload.ts`:
   - Stream `fs:extract-progress` events during `fs:extract` using `spawn` and expose `onExtractProgress` in `preload.ts`.
4. In `src/api/types.ts` and `src/api/tauriAdapter.ts`:
   - Add `ExtractProgressEvent` and `onExtractProgress` to `IApi` and `createTauriAdapter`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && bun test src/api/__tests__/`
Expected: PASS (all Rust tests and `tauriAdapter` / `commandParity` tests pass).

---

### Task 3: `Icon` (`fill` & `animateFill`), `Dialog` Label Clipping Fix, and Expressive `ContextMenu`

**Files:**
- Modify: `src/components/Icon.tsx`
- Modify: `src/components/Dialog.tsx`
- Modify: `src/components/ContextMenu.tsx`
- Test: `src/components/__tests__/uiStandardization.test.tsx`

**Interfaces:**
- Produces:
  - `IconProps` in `src/components/Icon.tsx`: adds `fill?: 0 | 1` and `animateFill?: boolean`
  - `splitIntoMenuGroups(items: ContextMenuItem[]): ContextMenuItem[][]` in `src/components/ContextMenu.tsx`

- [ ] **Step 1: Write failing tests in `src/components/__tests__/uiStandardization.test.tsx`**

Update the `ContextMenu` test and add `Icon` + `Dialog` tests in `src/components/__tests__/uiStandardization.test.tsx`:
```tsx
test('Dialog adds pt-2 to DialogBody content container so outlined TextField floating labels are not clipped', () => {
    const html = renderToStaticMarkup(
        <Dialog open onClose={() => {}} title="New Folder">
            <div>Body content</div>
        </Dialog>
    );
    expect(html).toContain('pt-2');
});

test('Icon supports fill={1}, fill={0}, and animateFill with font-variation-settings', () => {
    const filledHtml = renderToStaticMarkup(<Icon name="folder" fill={1} animateFill />);
    expect(filledHtml).toContain("'FILL' 1");

    const outlinedHtml = renderToStaticMarkup(<Icon name="folder" fill={0} animateFill />);
    expect(outlinedHtml).toContain("'FILL' 0");
});

test('ContextMenu uses Expressive VerticalMenu, VerticalMenuGroup role="group", MenuItem role="menuitem", and filters empty divider groups', () => {
    const html = renderToStaticMarkup(
        <ContextMenu
            x={120}
            y={80}
            onClose={() => {}}
            items={[
                { label: '', divider: true, action: () => {} },
                { label: 'Open', icon: 'open_in_new', action: () => {} },
                { label: '', divider: true, action: () => {} },
                { label: '', divider: true, action: () => {} },
                { label: 'Properties', icon: 'info', action: () => {} },
                { label: '', divider: true, action: () => {} },
            ]}
        />
    );

    expect(html).toContain('role="menu"');
    expect(html.match(/role="group"/g)?.length ?? 0).toBe(2);
    expect(html.match(/role="menuitem"/g)?.length ?? 0).toBe(2);
    expect(html).toContain('bg-m3-surface-container-low');
    expect(html).not.toContain('shadow-xl');
    expect(html).not.toContain('border-m3-outline-variant/40');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL (`Dialog` lacks `pt-2`, `ContextMenu` renders 0 `role="group"`).

- [ ] **Step 3: Implement `Icon.tsx`, `Dialog.tsx`, and `ContextMenu.tsx`**

1. In `src/components/Icon.tsx`:
   - Accept `fill?: 0 | 1` and `animateFill?: boolean`.
   - Compute `const effectiveFill: 0 | 1 = fill !== undefined ? fill : filled ? 1 : 0;` and `const fontVariationSettings = `'FILL' ${effectiveFill}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${resolvedOpsz}`;`.
   - When `animateFill` is true, render `<motion.span initial={false} animate={{ fontVariationSettings }} transition={FAST_EFFECTS_TRANSITION} ...>` from `motion/react` and `@bug-on/m3-expressive`.
2. In `src/components/Dialog.tsx`:
   - Change `<DialogBody>{children}</DialogBody>` to `<DialogBody contentClassName="pt-2">{children}</DialogBody>`.
3. In `src/components/ContextMenu.tsx`:
   - Export `splitIntoMenuGroups(items: ContextMenuItem[]): ContextMenuItem[][]` that splits `items` on `item.divider === true` and filters out empty groups.
   - Render `<VerticalMenu className="min-w-[200px]"><VerticalMenuContent separatorStyle="gap">` with `<VerticalMenuGroup>` and `<MenuItem leadingIcon={...} trailingText={item.shortcut} onClick={...}>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: PASS.

---

### Task 4: Toolbar `IconButton`s, Wavy Extraction Progress UI, New Tab Default, and Active Icon `animateFill` Across App

**Files:**
- Modify: `src/components/ExplorerTab.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/TabBar.tsx`
- Modify: `src/components/SettingsDialog.tsx`
- Test: `src/components/__tests__/uiStandardization.test.tsx`

**Interfaces:**
- Consumes:
  - `api.onExtractProgress` and `ExtractProgressEvent` from Task 2
  - `Icon` (`fill`, `animateFill`) from Task 3
  - `ProgressIndicator` from `@bug-on/m3-expressive`

- [ ] **Step 1: Write failing tests in `src/components/__tests__/uiStandardization.test.tsx`**

Update `ExplorerTab standardization` in `src/components/__tests__/uiStandardization.test.tsx`:
- Assert that `ExplorerTab` toolbar renders standalone `IconButton`s with `aria-pressed` on toggleable buttons (`Show Hidden Files` / `Hide Hidden Files`, `Enable Category Grouping` / `Disable Category Grouping`, `Sort by Name`, `Sort by Date`, `Sort by Type`, `Sort by Size`, `Switch to Grid View` / `Switch to List View`) and zero `<fieldset` (`ButtonGroup`) elements inside the toolbar.
- Assert that active toolbar toggle buttons render `'FILL' 1` on their icon (`Sort by Name` has `'FILL' 1` while `Sort by Date` has `'FILL' 0`).
- Assert that `Sidebar` active item (`app://trash`) renders `'FILL' 1` on its icon.
- Assert that `TabBar` active tab (`t1`) renders `'FILL' 1` while inactive tab (`t2`) renders `'FILL' 0`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/components/__tests__/uiStandardization.test.tsx`
Expected: FAIL (`ExplorerTab` still renders `<fieldset` `ButtonGroup`s and toolbar icons have `'FILL' 0`).

- [ ] **Step 3: Implement changes in `ExplorerTab.tsx`, `App.tsx`, `Sidebar.tsx`, `TabBar.tsx`, and `SettingsDialog.tsx`**

1. In `src/components/ExplorerTab.tsx`:
   - Remove `ButtonGroup` and `ToolbarGroupButton`.
   - Convert all 3 toolbar button clusters + View Mode button to standalone `<IconButton variant="tonal" size="sm" ...>` buttons (`toggle` + `selected={...}` for stateful buttons).
   - Pass `animateFill` and `fill={isSelected ? 1 : 0}` to all toggleable toolbar `Icon`s.
   - Subscribe to `api.onExtractProgress` and render the floating extraction progress card at `bottom-4 right-4 z-30` with `<ProgressIndicator variant="linear" shape="wavy" value={...} aria-label={...} />` while extracting.
2. In `src/App.tsx`:
   - Change `handleAddTab` default path to `const newPath = path || 'app://dashboard';`.
   - Pass `fill={0} animateFill` on `icon` and `fill={1} animateFill` on `activeIcon` for all `NavigationRail` items.
3. In `src/components/Sidebar.tsx`, `src/components/TabBar.tsx`, and `src/components/SettingsDialog.tsx`:
   - Pass `animateFill` and `fill={isSelected ? 1 : 0}` to icons with active/selected states.

- [ ] **Step 4: Run full test suite, linter, and web build**

Run: `bun test && cargo test --manifest-path src-tauri/Cargo.toml && npm run lint && npm run build:web`
Expected: PASS with 0 errors.
