# Design: Rebrand to Bug On Files M3, Logo Assets, Tauri Splash, Theme & README

**Date:** 2026-11-16
**Status:** Approved

## Intent
Rebrand the forked file explorer to **Bug On Files M3** (short name: **Files M3**; Vietnamese name **Bất Ổn Files M3** in `README.md` only), generate all transparent-background icon assets and a Tauri native logo-only splash screen from `src/assets/bug-on-files-m3.svg`, align the default Material 3 Expressive color palette with the logo's navy/sky-blue tones, and rewrite `README.md` with accurate fork attribution, tech stack, and distro-specific build instructions (Ubuntu/Debian/Linux Mint and Arch Linux).

## Goals & Non-Goals
- **Goals:**
  - Consistent English branding across app config, window titles, `.desktop` launcher (`Files M3`), and `AboutDialog` (`Bug On Files M3` + SVG logo).
  - Transparent-background icons generated from `src/assets/bug-on-files-m3.svg` for Tauri (`src-tauri/icons/*`), `assets/icon.png`, and web favicon.
  - Fast, frameless, transparent Tauri v2 native splash window displaying only the logo while the main window initializes.
  - Default M3 seed color updated to logo navy (`#1F305E`) with logo presets (`#1F305E`, `#99C0FB`) while preserving Matugen overrides.
  - Accurate `README.md` documenting fork origin (`bhimio1/material-3-file-explorer`), Tauri v2 + Rust + React 19 + `@bug-on/m3-expressive` stack, Arch Linux & Debian/Ubuntu/Mint build steps, and GitHub Release installation.
- **Non-Goals:**
  - Adding the logo to `NavigationRail` or other in-app chrome.
  - Full Vietnamese UI localization (Vietnamese name appears in `README.md` only).
  - Creating/publishing the GitHub Release itself during this implementation (covered after build/verification if desired).

## Approaches Considered
1. **Single-source SVG -> `tauri icon` + Tauri v2 native splash window (Chosen):**
   - Renders a 1024×1024 transparent PNG from `src/assets/bug-on-files-m3.svg` and uses `tauri icon` to generate all platform icons automatically. Uses a dedicated Tauri `splashscreen` window (`decorations: false`, `transparent: true`) that closes when the `main` window finishes mounting.
   - *Trade-off:* Adds a lightweight `splash.html` and a small Rust/TS readiness handshake, in exchange for instant startup feedback before WebView/React finishes loading.
2. **In-app React splash overlay (Rejected):**
   - Simpler, but only appears after WebView + JS bundle load, leaving a blank window flash at startup.

## Key Design Decisions
- **Naming:** Full name `Bug On Files M3`, short name `Files M3`, identifier `com.bugon.filesm3`, Cargo package `bug_on_files_m3` / `bug-on-files-m3` (or keeping internal crate name clean while setting `productName` & binary metadata).
- **Theme:** `DEFAULT_SEED_COLOR = '#1F305E'` in `src/utils/themeUtils.ts`; `PRESET_SEED_COLORS` leads with `Logo Navy` (`#1F305E`) and `Sky Blue` (`#99C0FB`).
- **Tests:** Update `src/components/__tests__/uiStandardization.test.tsx` and `src/utils/__tests__/themeUtils.test.ts` (if any) to reflect the new branding and default seed color.
