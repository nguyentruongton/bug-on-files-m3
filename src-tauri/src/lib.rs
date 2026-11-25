pub mod archive_tools;
pub mod commands;
pub mod desktop_entry;
pub mod extract;
pub mod fs_ops;
pub mod media;
pub mod places;
pub mod search;
pub mod system_info;
pub mod text_preview;
pub mod thumbnails;
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

pub fn cleanup_resources(app: &tauri::AppHandle) {
    if let Some(pty) = app.try_state::<PtySessions>() {
        pty.kill_all();
    }
    if let Some(watchers) = app.try_state::<Watchers>() {
        watchers.stop_all();
    }
}

#[tauri::command]
fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let media_semaphore = Arc::new(tokio::sync::Semaphore::new(4));
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("media", move |_ctx, req, responder| {
            let parsed = media::parse_request_route(&req);

            match parsed {
                Some((route @ (media::MediaRoute::Thumbnail(_) | media::MediaRoute::Preview), path)) => {
                    let sem = Arc::clone(&media_semaphore);
                    tauri::async_runtime::spawn(async move {
                        let fast_path = path.clone();
                        let fast_hit = tauri::async_runtime::spawn_blocking(move || match route {
                            media::MediaRoute::Thumbnail(size) => {
                                thumbnails::try_get_cached_or_svg_thumbnail(&fast_path, size)
                            }
                            media::MediaRoute::Preview => {
                                thumbnails::try_get_cached_or_svg_preview(&fast_path)
                            }
                            media::MediaRoute::Raw => None,
                        })
                        .await
                        .ok()
                        .flatten();

                        if let Some(cached) = fast_hit {
                            responder.respond(media::media_bytes_response(cached));
                            return;
                        }

                        let Ok(_permit) = sem.acquire_owned().await else {
                            responder.respond(
                                tauri::http::Response::builder()
                                    .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                                    .body(Vec::new())
                                    .unwrap(),
                            );
                            return;
                        };
                        let resp = tauri::async_runtime::spawn_blocking(move || {
                            media::handle_routed_media_request(&req, route, &path)
                        })
                        .await
                        .unwrap_or_else(|_| {
                            tauri::http::Response::builder()
                                .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                                .body(Vec::new())
                                .unwrap()
                        });
                        responder.respond(resp);
                    });
                }
                Some((route, path)) => {
                    tauri::async_runtime::spawn_blocking(move || {
                        let resp = media::handle_routed_media_request(&req, route, &path);
                        responder.respond(resp);
                    });
                }
                None => {
                    tauri::async_runtime::spawn_blocking(move || {
                        let resp = media::handle_media_request(&req);
                        responder.respond(resp);
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_dir,
            commands::fs::get_parent,
            commands::fs::get_home,
            commands::fs::copy_file,
            commands::fs::move_file,
            commands::fs::trash_file,
            commands::fs::list_trash,
            commands::fs::restore_trash_items,
            commands::fs::purge_trash_items,
            commands::fs::empty_trash,
            commands::fs::rename_file,
            commands::fs::create_directory,
            commands::fs::exists,
            commands::fs::read_file,
            commands::fs::get_places,
            commands::fs::read_text_preview,
            commands::fs::watch_start,
            commands::fs::watch_stop,
            commands::app::extract_file,
            commands::app::compress_files,
            commands::app::open_path,
            commands::app::open_file_dialog,
            commands::app::open_directory_dialog,
            commands::app::get_startup_path,
            commands::app::get_theme_css,
            commands::app::set_icon,
            commands::app::quit_app,
            commands::apps::get_apps,
            commands::apps::get_recommended_apps,
            commands::apps::open_with,
            commands::system::get_drives,
            commands::system::get_storage_usage,
            commands::system::get_directory_size,
            commands::system::search,
            commands::system::get_video_metadata,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            close_splashscreen,
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
                cleanup_resources(window.app_handle());
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

    #[test]
    fn test_tauri_conf_main_window_geometry_and_no_tiny_splash_toplevel() {
        let raw = include_str!("../tauri.conf.json");
        let cfg: serde_json::Value = serde_json::from_str(raw).expect("valid tauri.conf.json");
        let windows = cfg["app"]["windows"]
            .as_array()
            .expect("app.windows must be an array");

        assert!(
            !windows.iter().any(|w| w["label"].as_str() == Some("splashscreen")),
            "separate splashscreen toplevel window must not be configured (poisons per-class WM geometry on Wayland/Hyprland)"
        );

        let main = windows
            .iter()
            .find(|w| w["label"].as_str() == Some("main"))
            .expect("main window must exist");

        assert_ne!(main["visible"].as_bool(), Some(false), "main window should start visible");
        assert!(main["width"].as_u64().unwrap_or(0) >= 1000);
        assert!(main["height"].as_u64().unwrap_or(0) >= 640);
        assert!(main["minWidth"].as_u64().unwrap_or(0) >= 640);
        assert!(main["minHeight"].as_u64().unwrap_or(0) >= 480);
    }

    #[test]
    fn test_tauri_conf_main_binary_name_matches_desktop_entry() {
        let raw = include_str!("../tauri.conf.json");
        let cfg: serde_json::Value = serde_json::from_str(raw).expect("valid tauri.conf.json");
        assert_eq!(
            cfg["mainBinaryName"].as_str(),
            Some("bug-on-files-m3"),
            "mainBinaryName must match bug-on-files-m3.desktop for Wayland/dock icon resolution"
        );

        let install_sh = include_str!("../../install.sh");
        assert!(
            install_sh.contains("BINARY_ID=\"bug-on-files-m3\""),
            "install.sh must set BINARY_ID=\"bug-on-files-m3\""
        );
        assert!(
            install_sh.contains("StartupWMClass=bug-on-files-m3"),
            "install.sh must set StartupWMClass=bug-on-files-m3"
        );

        let pkgbuild = include_str!("../../PKGBUILD");
        assert!(
            pkgbuild.contains("StartupWMClass=bug-on-files-m3"),
            "PKGBUILD must set StartupWMClass=bug-on-files-m3"
        );
        assert!(
            pkgbuild.contains("usr/share/applications/bug-on-files-m3.desktop"),
            "PKGBUILD must install bug-on-files-m3.desktop for direct Wayland app_id matching"
        );
        assert!(
            pkgbuild.contains("Icon=bug-on-files-m3"),
            "PKGBUILD desktop entry must reference Icon=bug-on-files-m3"
        );
    }

    #[test]
    fn test_app_icon_assets_are_in_sync() {
        assert_eq!(
            include_str!("../../public/bug-on-files-m3.svg"),
            include_str!("../../src/assets/bug-on-files-m3.svg"),
            "public and src/assets SVG icons must stay identical"
        );
        assert_eq!(
            include_bytes!("../../icon.png").as_slice(),
            include_bytes!("../../assets/icon.png").as_slice(),
            "root icon.png and assets/icon.png must stay identical"
        );
    }
}

