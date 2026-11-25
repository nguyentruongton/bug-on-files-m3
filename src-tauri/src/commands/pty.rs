use crate::pty::PtySessions;
use std::sync::Arc;
use tauri::Emitter;

#[tauri::command(rename_all = "camelCase")]
pub async fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<'_, PtySessions>,
    cwd: String,
) -> Result<u32, String> {
    let app_handle_data = app.clone();
    let app_handle_exit = app.clone();

    let on_data = Arc::new(move |pid: u32, data: String| {
        let event_name = format!("terminal:data:{}", pid);
        let _ = app_handle_data.emit(&event_name, data);
    });

    let on_exit = Arc::new(move |pid: u32| {
        let event_name = format!("terminal:exit:{}", pid);
        let _ = app_handle_exit.emit(&event_name, ());
    });

    let sessions = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || sessions.spawn(&cwd, on_data, on_exit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub fn pty_write(state: tauri::State<'_, PtySessions>, pid: u32, data: String) {
    state.write(pid, &data);
}

#[tauri::command(rename_all = "camelCase")]
pub fn pty_resize(state: tauri::State<'_, PtySessions>, pid: u32, cols: u16, rows: u16) {
    state.resize(pid, cols, rows);
}

#[tauri::command(rename_all = "camelCase")]
pub async fn pty_kill(state: tauri::State<'_, PtySessions>, pid: u32) -> Result<(), String> {
    let sessions = state.inner().clone();
    let _ = tauri::async_runtime::spawn_blocking(move || sessions.kill(pid)).await;
    Ok(())
}
