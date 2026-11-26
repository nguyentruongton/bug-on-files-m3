use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub fn resolve_startup_path(args: &[String], exe: Option<&str>) -> Option<String> {
    if args.len() <= 1 {
        return None;
    }

    for arg in args.iter().skip(1).rev() {
        if arg.is_empty()
            || arg == "."
            || arg.starts_with('-')
            || arg.contains('\0')
            || exe == Some(arg.as_str())
        {
            continue;
        }

        let candidate = if arg.starts_with("file://") {
            let Ok(url) = tauri::Url::parse(arg) else {
                continue;
            };
            if url.scheme() != "file"
                || !matches!(url.host_str(), None | Some("") | Some("localhost"))
            {
                continue;
            }
            match url.to_file_path() {
                Ok(p) => p,
                Err(_) => continue,
            }
        } else {
            let p = Path::new(arg);
            if !p.is_absolute() {
                continue;
            }
            p.to_path_buf()
        };

        if candidate.to_str().is_none_or(|s| s.contains('\0')) {
            continue;
        }

        if let Ok(meta) = std::fs::metadata(&candidate) {
            if meta.is_dir() {
                return candidate.to_str().map(|s| s.to_string());
            } else if meta.is_file() {
                return candidate
                    .parent()
                    .and_then(|p| p.to_str())
                    .map(|s| s.to_string());
            }
        }
    }

    None
}

pub fn resolve_icon_path(app_res_dir: Option<&Path>, icon_type: &str) -> Option<PathBuf> {
    let as_path = Path::new(icon_type);
    if as_path.is_absolute() {
        if as_path.exists() {
            return Some(as_path.to_path_buf());
        }
        return None;
    }

    let file_name = format!("icon-{}.png", icon_type);
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(res_dir) = app_res_dir {
        candidates.push(res_dir.join("assets").join(&file_name));
        candidates.push(res_dir.join(&file_name));
    }

    candidates.push(PathBuf::from("assets").join(&file_name));
    candidates.push(PathBuf::from("../assets").join(&file_name));
    candidates.push(PathBuf::from("src-tauri/icons").join(&file_name));

    candidates.into_iter().find(|candidate| candidate.exists())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn extract_file(
    app: tauri::AppHandle,
    path: String,
    dest_dir: Option<String>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::extract::extract_file_with_progress_to(&path, dest_dir.as_deref(), |payload| {
            let _ = app.emit("fs:extract-progress", payload);
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn compress_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
    dest_archive_path: String,
    format: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::archive_tools::compress_files_with_progress(
            &paths,
            &dest_archive_path,
            &format,
            |payload| {
                let _ = app.emit("fs:compress-progress", payload);
            },
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_path(app: tauri::AppHandle, path: String) -> String {
    tauri::async_runtime::spawn_blocking(move || {
        match app.opener().open_path(path, None::<&str>) {
            Ok(_) => String::new(),
            Err(e) => e.to_string(),
        }
    })
    .await
    .unwrap_or_else(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("CSS Files", &["css"])
        .pick_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    let chosen = rx.await.ok().flatten()?;
    chosen.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_directory_dialog(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |dir_path| {
        let _ = tx.send(dir_path);
    });

    let chosen = rx.await.ok().flatten()?;
    chosen.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_startup_path() -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let args: Vec<String> = std::env::args().collect();
        let exe = std::env::current_exe()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_string()));
        resolve_startup_path(&args, exe.as_deref())
    })
    .await
    .ok()
    .flatten()
}

pub fn resolve_theme_css_from_home(home: &Path) -> Option<String> {
    const CANDIDATES: [&str; 4] = [
        ".config/matugen/theme.css",
        ".local/state/caelestia/scheme.json",
        ".config/gtk-4.0/gtk.css",
        ".config/gtk-3.0/gtk.css",
    ];
    for rel in CANDIDATES {
        let path = home.join(rel);
        if let Ok(content) = std::fs::read_to_string(path) {
            if !content.trim().is_empty() {
                return Some(content);
            }
        }
    }
    None
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_theme_css() -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = dirs::home_dir()?;
        resolve_theme_css_from_home(&home)
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn set_icon(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    icon_type: String,
) -> Result<(), String> {
    let res_dir = app.path().resource_dir().ok();
    let image = tauri::async_runtime::spawn_blocking(move || {
        if let Some(icon_path) = resolve_icon_path(res_dir.as_deref(), &icon_type) {
            let img = tauri::image::Image::from_path(&icon_path).map_err(|e| e.to_string())?;
            Ok::<Option<tauri::image::Image<'static>>, String>(Some(img.to_owned()))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(image) = image {
        window.set_icon(image).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn start_native_drag(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
    label: Option<String>,
    is_directory: bool,
) -> Result<bool, String> {
    crate::native_drag::start_drag_on_window(window, paths, label, is_directory).await
}

#[tauri::command(rename_all = "camelCase")]
pub fn quit_app(app: tauri::AppHandle) {
    crate::cleanup_resources(&app);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn startup_path_args_len_le_1_returns_none() {
        assert_eq!(resolve_startup_path(&[], None), None);
        assert_eq!(
            resolve_startup_path(&["materials".to_string()], None),
            None
        );
    }

    #[test]
    fn startup_path_dot_returns_none() {
        let args = vec!["materials".to_string(), ".".to_string()];
        assert_eq!(resolve_startup_path(&args, None), None);
    }

    #[test]
    fn startup_path_exe_returns_none() {
        let exe = "/usr/bin/materials";
        let args = vec!["materials".to_string(), exe.to_string()];
        assert_eq!(resolve_startup_path(&args, Some(exe)), None);
    }

    #[test]
    fn startup_path_relative_returns_none() {
        let args = vec!["materials".to_string(), "some/relative/path".to_string()];
        assert_eq!(resolve_startup_path(&args, None), None);
    }

    #[test]
    fn startup_path_nonexistent_returns_none() {
        let args = vec![
            "materials".to_string(),
            "/definitely/nonexistent/path/xyz123".to_string(),
        ];
        assert_eq!(resolve_startup_path(&args, None), None);
    }

    #[test]
    fn startup_path_of_dir_returns_itself() {
        let dir = tempdir().expect("create tempdir");
        let dir_str = dir.path().to_str().expect("valid utf-8").to_string();
        let args = vec!["materials".to_string(), dir_str.clone()];
        assert_eq!(resolve_startup_path(&args, None), Some(dir_str));
    }

    #[test]
    fn startup_path_of_file_returns_parent() {
        let dir = tempdir().expect("create tempdir");
        let file_path = dir.path().join("child.txt");
        std::fs::write(&file_path, "test").expect("write child file");

        let file_str = file_path.to_str().expect("valid utf-8").to_string();
        let dir_str = dir.path().to_str().expect("valid utf-8").to_string();

        let args = vec!["materials".to_string(), file_str];
        assert_eq!(resolve_startup_path(&args, None), Some(dir_str));
    }

    #[test]
    fn startup_path_decodes_local_file_uri_and_rejects_remote_nul_and_flags() {
        let dir = tempdir().expect("create tempdir");
        let spaced = dir.path().join("café folder");
        std::fs::create_dir(&spaced).expect("create spaced dir");
        let encoded_dir = format!(
            "file://{}/caf%C3%A9%20folder",
            dir.path().to_str().expect("valid utf-8")
        );

        let args_uri = vec!["bug-on-files-m3".to_string(), encoded_dir];
        assert_eq!(
            resolve_startup_path(&args_uri, None),
            Some(spaced.to_str().unwrap().to_string())
        );

        let localhost_uri = format!(
            "file://localhost{}/caf%C3%A9%20folder",
            dir.path().to_str().expect("valid utf-8")
        );
        let args_localhost = vec!["bug-on-files-m3".to_string(), localhost_uri];
        assert_eq!(
            resolve_startup_path(&args_localhost, None),
            Some(spaced.to_str().unwrap().to_string())
        );

        // Remote file:// host must be rejected
        let args_remote = vec![
            "bug-on-files-m3".to_string(),
            "file://server/share/folder".to_string(),
        ];
        assert_eq!(resolve_startup_path(&args_remote, None), None);

        // NUL byte (raw and percent-encoded %00 in file:// URI) must be rejected
        let args_nul = vec![
            "bug-on-files-m3".to_string(),
            format!("{}\0evil", dir.path().to_str().unwrap()),
        ];
        assert_eq!(resolve_startup_path(&args_nul, None), None);

        let args_encoded_nul = vec![
            "bug-on-files-m3".to_string(),
            format!("file://{}/bad%00evil", dir.path().to_str().unwrap()),
        ];
        assert_eq!(resolve_startup_path(&args_encoded_nul, None), None);

        // Trailing flag is skipped while preceding valid path is accepted
        let args_with_flag = vec![
            "bug-on-files-m3".to_string(),
            spaced.to_str().unwrap().to_string(),
            "--version".to_string(),
        ];
        assert_eq!(
            resolve_startup_path(&args_with_flag, None),
            Some(spaced.to_str().unwrap().to_string())
        );
    }

    #[test]
    fn test_extract_file_unsupported_returns_false() {
        let result = crate::extract::extract_file_with_progress(
            "/tmp/nonexistent_archive.unsupported",
            |_| {},
        );
        assert_eq!(result, Ok(false));
    }

    #[test]
    fn test_extract_file_tar_success() {
        let dir = tempdir().expect("create tempdir");
        let src_file = dir.path().join("hello.txt");
        std::fs::write(&src_file, "hello archive").expect("write test file");

        let tar_file = dir.path().join("archive.tar");
        let status = std::process::Command::new("tar")
            .arg("-cf")
            .arg(&tar_file)
            .arg("-C")
            .arg(dir.path())
            .arg("hello.txt")
            .status()
            .expect("tar spawn");
        assert!(status.success());

        // Now extract into another directory
        let extract_dir = tempdir().expect("create extract dir");
        let tar_copy = extract_dir.path().join("archive.tar");
        std::fs::copy(&tar_file, &tar_copy).expect("copy tar");

        let mut events = Vec::new();
        let result = crate::extract::extract_file_with_progress(
            tar_copy.to_str().unwrap(),
            |ev| events.push(ev),
        );
        assert_eq!(result, Ok(true));
        assert!(extract_dir.path().join("hello.txt").exists());
        assert_eq!(
            std::fs::read_to_string(extract_dir.path().join("hello.txt")).unwrap(),
            "hello archive"
        );
        assert!(events.iter().any(|e| e.total_count == 1 && e.extracted_count == 1));
        let last = events.last().expect("final progress event");
        assert!(last.done);
        assert_eq!(last.percent, Some(100.0));
    }

    #[test]
    fn test_resolve_icon_path_missing_returns_none() {
        assert_eq!(resolve_icon_path(None, "nonexistent-icon-type"), None);
    }

    #[test]
    fn test_resolve_icon_path_absolute_exists() {
        let dir = tempdir().expect("create tempdir");
        let icon_file = dir.path().join("custom.png");
        std::fs::write(&icon_file, b"fake png").expect("write fake icon");

        let icon_str = icon_file.to_str().unwrap().to_string();
        assert_eq!(
            resolve_icon_path(None, &icon_str),
            Some(icon_file)
        );
    }

    #[test]
    fn test_resolve_icon_path_relative_candidate() {
        let dir = tempdir().expect("create tempdir");
        let assets_dir = dir.path().join("assets");
        std::fs::create_dir(&assets_dir).expect("create assets dir");
        let icon_file = assets_dir.join("icon-dark.png");
        std::fs::write(&icon_file, b"fake png").expect("write fake icon");

        assert_eq!(
            resolve_icon_path(Some(dir.path()), "dark"),
            Some(icon_file)
        );
    }

    #[test]
    fn test_get_startup_path_smoke() {
        tauri::async_runtime::block_on(async {
            let _ = get_startup_path().await;
        });
    }

    #[test]
    fn test_get_theme_css_smoke() {
        tauri::async_runtime::block_on(async {
            let _ = get_theme_css().await;
        });
    }

    #[test]
    fn test_resolve_theme_css_from_home_priority_and_empty_skip() {
        let dir = tempdir().expect("create tempdir");
        let home = dir.path();

        assert_eq!(resolve_theme_css_from_home(home), None);

        let gtk3_dir = home.join(".config/gtk-3.0");
        std::fs::create_dir_all(&gtk3_dir).unwrap();
        std::fs::write(gtk3_dir.join("gtk.css"), "@define-color accent_color #333333;").unwrap();
        assert_eq!(
            resolve_theme_css_from_home(home).as_deref(),
            Some("@define-color accent_color #333333;")
        );

        let gtk4_dir = home.join(".config/gtk-4.0");
        std::fs::create_dir_all(&gtk4_dir).unwrap();
        std::fs::write(gtk4_dir.join("gtk.css"), "@define-color accent_color #444444;").unwrap();
        assert_eq!(
            resolve_theme_css_from_home(home).as_deref(),
            Some("@define-color accent_color #444444;")
        );

        let caelestia_dir = home.join(".local/state/caelestia");
        std::fs::create_dir_all(&caelestia_dir).unwrap();
        std::fs::write(caelestia_dir.join("scheme.json"), "{\"primary\":\"f9b6ae\"}").unwrap();
        assert_eq!(
            resolve_theme_css_from_home(home).as_deref(),
            Some("{\"primary\":\"f9b6ae\"}")
        );

        // Empty matugen file should be skipped in favor of Caelestia scheme.json
        let matugen_dir = home.join(".config/matugen");
        std::fs::create_dir_all(&matugen_dir).unwrap();
        std::fs::write(matugen_dir.join("theme.css"), "   \n  ").unwrap();
        assert_eq!(
            resolve_theme_css_from_home(home).as_deref(),
            Some("{\"primary\":\"f9b6ae\"}")
        );

        // Non-empty matugen theme.css takes highest priority
        std::fs::write(matugen_dir.join("theme.css"), ":root { --md-sys-color-primary: #111111; }").unwrap();
        assert_eq!(
            resolve_theme_css_from_home(home).as_deref(),
            Some(":root { --md-sys-color-primary: #111111; }")
        );
    }
}
