pub mod commands;
pub mod desktop_entry;
pub mod extract;
pub mod fs_ops;
pub mod places;
pub mod search;
pub mod system_info;
pub mod text_preview;
pub mod pty;
pub mod watcher;

use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use pty::PtySessions;
use watcher::Watchers;

pub fn resolve_target_url(
    raw: &str,
    current: Option<&tauri::Url>,
) -> Result<tauri::Url, Box<dyn std::error::Error>> {
    match tauri::Url::parse(raw) {
        Ok(url) => Ok(url),
        Err(url::ParseError::RelativeUrlWithoutBase) => {
            if let Some(base) = current {
                Ok(base.join(raw)?)
            } else {
                let fallback = tauri::Url::parse("tauri://localhost/")?;
                Ok(fallback.join(raw)?)
            }
        }
        Err(e) => Err(Box::new(e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_dir,
            commands::fs::get_parent,
            commands::fs::get_home,
            commands::fs::copy_file,
            commands::fs::move_file,
            commands::fs::trash_file,
            commands::fs::rename_file,
            commands::fs::create_directory,
            commands::fs::exists,
            commands::fs::read_file,
            commands::fs::get_places,
            commands::fs::read_text_preview,
            commands::fs::watch_start,
            commands::fs::watch_stop,
            commands::app::extract_file,
            commands::app::open_path,
            commands::app::open_file_dialog,
            commands::app::open_directory_dialog,
            commands::app::get_startup_path,
            commands::app::get_theme_css,
            commands::app::set_icon,
            commands::apps::get_apps,
            commands::apps::get_recommended_apps,
            commands::apps::open_with,
            commands::system::get_drives,
            commands::system::get_storage_usage,
            commands::system::get_directory_size,
            commands::system::search,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let watchers = Watchers::new(
                Arc::new(move |ev| {
                    let _ = app_handle.emit("fs:watch-event", ev);
                }),
                Duration::from_millis(150),
            );
            app.manage(watchers);

            let pty_sessions = PtySessions::new();
            app.manage(pty_sessions);

            if let Ok(spike_url_str) = std::env::var("MATERIALS_SPIKE_URL") {
                if let Some(window) = app.get_webview_window("main") {
                    let current = window.url().ok();
                    if let Ok(target) = resolve_target_url(&spike_url_str, current.as_ref()) {
                        let _ = window.navigate(target);
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(pty) = app.try_state::<PtySessions>() {
                    pty.kill_all();
                }
                if let Some(watchers) = app.try_state::<Watchers>() {
                    watchers.stop_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_absolute_url() {
        let url = resolve_target_url("http://127.0.0.1:8787/ready", None).unwrap();
        assert_eq!(url.as_str(), "http://127.0.0.1:8787/ready");
    }

    #[test]
    fn test_resolve_relative_url_with_base() {
        let base = tauri::Url::parse("http://tauri.localhost/index.html").unwrap();
        let url = resolve_target_url("spike.html?ping=http://127.0.0.1:8787/ready", Some(&base)).unwrap();
        assert_eq!(url.as_str(), "http://tauri.localhost/spike.html?ping=http://127.0.0.1:8787/ready");

        let slash_url = resolve_target_url("/spike.html?ping=http://127.0.0.1:8787/ready", Some(&base)).unwrap();
        assert_eq!(slash_url.as_str(), "http://tauri.localhost/spike.html?ping=http://127.0.0.1:8787/ready");
    }

    #[test]
    fn test_resolve_relative_url_fallback() {
        let url = resolve_target_url("spike.html?ping=http://127.0.0.1:8787/ready", None).unwrap();
        assert_eq!(url.as_str(), "tauri://localhost/spike.html?ping=http://127.0.0.1:8787/ready");
    }
}

