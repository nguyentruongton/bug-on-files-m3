# App Icon Sizing & Wayland/Desktop Identity Fix — Short Design

**Date:** 2026-11-25
**Status:** Approved

## Intent & Why
Make the **Files M3** app icon display cleanly and consistently across Linux desktop environments (Hyprland launcher, dock, and window title bar):
1. Scale up and center the app icon so its visual weight matches neighboring apps in the launcher and dock.
2. Fix the missing icon (pink-black placeholder in dock, absent icon on title bar) caused by a Wayland `app_id` / `StartupWMClass` mismatch.

## Goals, Non-Goals, Anti-Goals
- **Goals:**
  - Folder icon fills ~85% width of the square canvas and is optically centered horizontally and vertically.
  - All icon assets (`public/bug-on-files-m3.svg`, `src/assets/bug-on-files-m3.svg`, `assets/icon.png`, `icon.png`, `src-tauri/icons/*`) are regenerated from the updated SVG.
  - Runtime window `app_id` / `WM_CLASS` matches `bug-on-files-m3`, aligning with `bug-on-files-m3.desktop` and `StartupWMClass=bug-on-files-m3` in `install.sh` and `PKGBUILD`.
  - Rebuild and verify the installed desktop entry/icon and running window class.
- **Non-Goals:**
  - Redesigning the folder/bug artwork or adding a circular/squircle background plate.
  - Renaming the Rust Cargo package (`materials`) or `materials_lib` / thumbnail cache paths.
- **Anti-Goals:**
  - Leaving `public/bug-on-files-m3.svg` and `src/assets/bug-on-files-m3.svg` out of sync.
  - Breaking existing Cargo unit tests or Tauri AppImage bundling.

## Approaches Considered
1. **Set `mainBinaryName: "bug-on-files-m3"` in `src-tauri/tauri.conf.json` + `StartupWMClass=bug-on-files-m3` in `install.sh` / `PKGBUILD` (Selected):**
   - Makes the compiled Linux binary and GTK/Wayland `app_id` equal `bug-on-files-m3`, matching `bug-on-files-m3.desktop` directly without needing fallback matching, and avoids renaming `materials_lib` or cache directories.
2. **Keep binary name `materials` and only change `StartupWMClass=materials`:**
   - Rejected because `class='materials'` remains misleading and does not match the `.desktop` filename `bug-on-files-m3.desktop` (weaker Wayland compatibility).
3. **Rename Cargo crate `[package] name` to `bug-on-files-m3`:**
   - Rejected as unnecessary churn across `Cargo.toml`, `main.rs`, `materials_lib`, and tests.

## Decisions & Scope
- **SVG framing:** Keep the existing folder + beetle paths unchanged; adjust the `viewBox` (or root transform) of both `public/bug-on-files-m3.svg` and `src/assets/bug-on-files-m3.svg` so the folder bounding box (`x: 223.5..773.0`, `y: 223.5..725.0`, size `549.5 × 501.5`) occupies ~85% of the square canvas width (~7.5% horizontal margin, centered vertically).
- **Raster icon regeneration:** Render a crisp 1024×1024 master PNG from the updated SVG, update `assets/icon.png` and `icon.png` (512×512), and regenerate `src-tauri/icons/*` via `tauri icon`.
- **Tauri & packaging metadata:**
  - Add `"mainBinaryName": "bug-on-files-m3"` to `src-tauri/tauri.conf.json`.
  - Update `StartupWMClass=bug-on-files-m3` in `install.sh` and `PKGBUILD`.
  - Add a unit test in `src-tauri/src/lib.rs` asserting `tauri.conf.json` sets `mainBinaryName` to `"bug-on-files-m3"`.
- **Verification:** Run `cargo test`, check PNG bounding boxes (~85% width, centered), build the Tauri app/AppImage, and verify runtime `app_id` / `.desktop` matching.
