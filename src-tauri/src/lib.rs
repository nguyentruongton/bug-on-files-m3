pub mod commands;
pub mod fs_ops;
pub mod places;
pub mod text_preview;

use tauri::Manager;

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
        ])
        .setup(|app| {
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

