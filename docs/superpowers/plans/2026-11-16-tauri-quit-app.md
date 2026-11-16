# Tauri `quit_app` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **Quit** in the tab bar context menu cleanly shut down PTY sessions and file watchers and exit the Tauri application process instead of leaving a blank dark window.

**Architecture:** Extract a shared `cleanup_resources` helper in `src-tauri/src/lib.rs` for both `WindowEvent::Destroyed` and a new `quit_app` Tauri command in `src-tauri/src/commands/app.rs` that calls `app.exit(0)`. Map `quitApp` to `'quit_app'` in `src/api/commandMap.ts` and invoke it from `src/api/tauriAdapter.ts`.

**Tech Stack:** Rust / Tauri v2 (`src-tauri`), TypeScript, Bun test (`bun test`).

**Spec:** `docs/superpowers/specs/2026-11-16-tauri-quit-app-design.md`

## Global Constraints

- Electron's `app:quit` behavior (`electron/main.ts`) must remain unchanged.
- `PtySessions::kill_all()` and `Watchers::stop_all()` must run before `app.exit(0)`.
- Tauri commands must be mapped via `COMMAND_MAP` in `src/api/commandMap.ts`.

## Review Focus

- Calling `quit_app` when `PtySessions` or `Watchers` state is not yet managed (e.g., unit/mocked contexts): `app.try_state::<...>()` must be used rather than `app.state::<...>()`, so missing state never panics.
- Calling `quitApp` in `tauriAdapter` must invoke `quit_app` with no extra arguments rather than calling `window.close()`.

---

### Task 1: Backend `cleanup_resources` helper and `quit_app` command

**Files:**
- Modify: `src-tauri/src/lib.rs:106-181`
- Modify: `src-tauri/src/commands/app.rs`
- Test: `src-tauri/src/commands/app.rs` (via `cargo test`)

**Interfaces:**
- Produces:
  - `pub fn cleanup_resources(app: &tauri::AppHandle)` in `src-tauri/src/lib.rs`
  - `#[tauri::command(rename_all = "camelCase")] pub fn quit_app(app: tauri::AppHandle)` in `src-tauri/src/commands/app.rs`, registered in `tauri::generate_handler!`

- [ ] **Step 1: Add `cleanup_resources` helper in `src-tauri/src/lib.rs` and reuse it in `on_window_event`**

Define `pub fn cleanup_resources(app: &tauri::AppHandle)` in `src-tauri/src/lib.rs` using `app.try_state::<PtySessions>()` -> `kill_all()` and `app.try_state::<Watchers>()` -> `stop_all()`, and replace the inline cleanup in `on_window_event` (`WindowEvent::Destroyed`) with `cleanup_resources(window.app_handle())`.

- [ ] **Step 2: Add `quit_app` command in `src-tauri/src/commands/app.rs` and register it in `src-tauri/src/lib.rs`**

Add `#[tauri::command(rename_all = "camelCase")] pub fn quit_app(app: tauri::AppHandle)` in `src-tauri/src/commands/app.rs` that calls `crate::cleanup_resources(&app)` and `app.exit(0)`. Add `commands::app::quit_app` to `tauri::generate_handler!` in `src-tauri/src/lib.rs`.

- [ ] **Step 3: Run Rust tests and check compilation**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: All Rust unit tests pass with exit code 0 and zero compiler errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands/app.rs
git commit -m "fix(tauri): add quit_app command with resource cleanup"
```

---

### Task 2: Frontend `COMMAND_MAP` and `tauriAdapter.quitApp`

**Files:**
- Modify: `src/api/commandMap.ts:3-46`
- Modify: `src/api/tauriAdapter.ts:132-136`
- Test: `src/api/__tests__/tauriAdapter.test.ts`

**Interfaces:**
- Consumes: Tauri command `'quit_app'` registered in Task 1
- Produces: `COMMAND_MAP.quitApp = 'quit_app'` and `adapter.quitApp()` invoking `COMMAND_MAP.quitApp`

- [ ] **Step 1: Write the failing test in `src/api/__tests__/tauriAdapter.test.ts`**

Add a test in `describe('tauriAdapter', ...)`:

```ts
    test('quitApp calls quit_app', async () => {
        const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
        const invoke = async (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
        };
        const listen = async () => () => {};
        const adapter = createTauriAdapter(invoke, listen);

        await adapter.quitApp();
        expect(calls).toEqual([{ cmd: 'quit_app', args: undefined }]);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/api/__tests__/tauriAdapter.test.ts`
Expected: FAIL — `calls` is `[]` instead of `[{ cmd: 'quit_app', args: undefined }]`.

- [ ] **Step 3: Update `src/api/commandMap.ts` and `src/api/tauriAdapter.ts`**

1. In `src/api/commandMap.ts`, remove `'quitApp'` from the `Exclude<keyof IApi, ...>` union and add `quitApp: 'quit_app'` to `COMMAND_MAP`.
2. In `src/api/tauriAdapter.ts`, replace the `window.close()` implementation of `quitApp` with `() => invoke(COMMAND_MAP.quitApp) as Promise<void>`.

- [ ] **Step 4: Run tests and TypeScript/Vite build to verify**

Run: `bun test src/api/__tests__/tauriAdapter.test.ts && npm run build:web`
Expected: `tauriAdapter.test.ts` passes (including `'every COMMAND_MAP key exists on the adapter'` and `'quitApp calls quit_app'`) and `npm run build:web` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/api/commandMap.ts src/api/tauriAdapter.ts src/api/__tests__/tauriAdapter.test.ts
git commit -m "fix(api): invoke quit_app in tauriAdapter instead of window.close"
```
