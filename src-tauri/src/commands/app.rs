use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub fn resolve_startup_path(args: &[String], exe: Option<&str>) -> Option<String> {
    if args.len() <= 1 {
        return None;
    }

    let last_arg = args.last()?;
    if last_arg.is_empty() || last_arg == "." || exe == Some(last_arg.as_str()) {
        return None;
    }

    let path = Path::new(last_arg);
    if !path.is_absolute() {
        return None;
    }

    match std::fs::metadata(path) {
        Ok(meta) => {
            if meta.is_dir() {
                Some(last_arg.clone())
            } else if meta.is_file() {
                path.parent()
                    .and_then(|p| p.to_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        }
        Err(_) => None,
    }
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
pub async fn extract_file(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::extract::extract_file_with_progress(&path, |payload| {
            let _ = app.emit("fs:extract-progress", payload);
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_path(app: tauri::AppHandle, path: String) -> String {
    match app.opener().open_path(path, None::<&str>) {
        Ok(_) => String::new(),
        Err(e) => e.to_string(),
    }
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
pub fn get_startup_path() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()));
    resolve_startup_path(&args, exe.as_deref())
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
pub fn get_theme_css() -> Option<String> {
    let home = dirs::home_dir()?;
    resolve_theme_css_from_home(&home)
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_icon(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    icon_type: String,
) -> Result<(), String> {
    let res_dir = app.path().resource_dir().ok();
    if let Some(icon_path) = resolve_icon_path(res_dir.as_deref(), &icon_type) {
        let image = tauri::image::Image::from_path(&icon_path).map_err(|e| e.to_string())?;
        window.set_icon(image).map_err(|e| e.to_string())?;
    }
    Ok(())
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
        // Just verify calling get_startup_path() returns Option<String> without panic
        let _ = get_startup_path();
    }

    #[test]
    fn test_get_theme_css_smoke() {
        // Just verify calling get_theme_css() returns Option<String> without panic
        let _ = get_theme_css();
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
