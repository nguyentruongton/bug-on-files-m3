# Tauri `quit_app` Design

**Date:** 2026-11-16  
**Status:** Approved

## Intent & Why

When right-clicking the tab bar and selecting **Quit**, `handleQuitApp` in `src/App.tsx` calls `api.quitApp()`. On Tauri, `tauriAdapter.ts` currently calls `window.close()`, which on Linux (WebKitGTK) tears down the webview document while leaving the native Tauri window open as an empty black frame. The app should cleanly shut down background resources and exit the process completely.

## Goals / Non-Goals / Anti-Goals

- **Goal:** Selecting **Quit** in Tauri cleanly stops active PTY sessions and file watchers, closes the app, and exits the process.
- **Non-Goal:** Changing Electron's `app:quit` behavior (it already calls `app.quit()`).
- **Anti-Goal:** Calling `app.exit(0)` without cleaning up `PtySessions` and `Watchers`, which could leave orphaned child processes.

## Constraints

- Cleanup of `PtySessions` (`kill_all()`) and `Watchers` (`stop_all()`) currently lives in `on_window_event` (`WindowEvent::Destroyed`) in `src-tauri/src/lib.rs`.
- All Tauri IPC commands in this repo are mapped via `COMMAND_MAP` in `src/api/commandMap.ts` and invoked via `tauriAdapter.ts`.

## Approaches

1. **Custom `quit_app` Tauri command (Selected):** Add `#[tauri::command] pub fn quit_app(app: tauri::AppHandle)` in `src-tauri/src/commands/app.rs`, extract a shared cleanup helper in `src-tauri/src/lib.rs` (or call `PtySessions::kill_all` and `Watchers::stop_all` directly), call `app.exit(0)`, register it in `invoke_handler`, and map `quitApp: 'quit_app'` in `COMMAND_MAP`.
   - *Trade-off:* Matches the existing `COMMAND_MAP` + `tauriAdapter` architecture, requires no capability schema changes, and guarantees cleanup before exit.
2. **Tauri JS `exit(0)` / `getCurrentWindow().close()`:** Requires adding capabilities in `src-tauri/capabilities/default.json` and `exit(0)` bypasses `WindowEvent::Destroyed` cleanup. Rejected.

## Design

- **Backend (`src-tauri`):**
  - Extract or share `cleanup_resources(app: &tauri::AppHandle)` to stop `PtySessions` and `Watchers`, used by both `WindowEvent::Destroyed` in `src-tauri/src/lib.rs` and `quit_app`.
  - Add `#[tauri::command] pub fn quit_app(app: tauri::AppHandle)` in `src-tauri/src/commands/app.rs` that cleans up resources and calls `app.exit(0)`.
  - Register `commands::app::quit_app` in `tauri::generate_handler!` in `src-tauri/src/lib.rs`.
- **Frontend (`src/api`):**
  - Remove `'quitApp'` from the `Exclude<keyof IApi, ...>` list in `src/api/commandMap.ts` and add `quitApp: 'quit_app'` to `COMMAND_MAP`.
  - Update `quitApp` in `src/api/tauriAdapter.ts` to call `invoke(COMMAND_MAP.quitApp) as Promise<void>`.
- **Verification:**
  - Unit tests for `tauriAdapter` (`quitApp` invokes `quit_app`) and `cargo test` in `src-tauri`.
