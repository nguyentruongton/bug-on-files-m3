# Prevent Accidental UI Text and Icon Selection

## Intent & Why
Because Material 3 File Explorer runs in Electron (Chromium) and uses Material Symbols font ligatures for icons, touchpad gestures such as three-finger drag or double-tap drag trigger browser text selection across UI chrome (NavigationRail, Sidebar, Breadcrumbs, group headers, buttons, and icons). A native desktop file manager should never highlight UI labels or icon ligatures as selectable document text.

## Goals, Non-Goals, Anti-Goals
- **Goals:** Prevent accidental text/icon selection across all application UI chrome while preserving text selection and cursor interaction where users expect it.
- **Non-Goals:** Changing how file item selection or HTML5 file drag-and-drop works.
- **Anti-Goals:** Breaking `<input>`/`<textarea>` editing, QuickLook text preview copying, Properties dialog path copying, or integrated Terminal (`xterm`) text selection.

## Constraints
- Must not interfere with HTML5 drag-and-drop events in `FileList` / `ExplorerTab`.
- Must work globally across current and future UI components without requiring per-component boilerplate.

## Approaches Considered
1. **Global CSS `user-select: none` with explicit opt-ins (Chosen):** Set `-webkit-user-select: none; user-select: none;` on `:root` and `.material-symbols-rounded` in `src/index.css`, and explicitly opt in `input, textarea, [contenteditable="true"], .xterm, .xterm *` with `user-select: text` (alongside existing opt-ins in `.quicklook-text-content` and `PropertiesDialog`).
2. **Per-component `user-select: none`:** Fragile and easy to miss on new components or headers.
3. **JavaScript `selectstart` / `mousedown` prevention:** Risk of interfering with native HTML5 drag-and-drop and input focus/selection behavior.

## Design
- Update `src/index.css`:
  - Add `-webkit-user-select: none; user-select: none;` to `.material-symbols-rounded` and `:root`.
  - Add rule `input, textarea, [contenteditable="true"], .xterm, .xterm * { -webkit-user-select: text; user-select: text; }`.
- Retain existing `user-select: text` on `.quicklook-text-content` (`src/components/QuickLook.css`) and file location in `src/components/PropertiesDialog.tsx`.
