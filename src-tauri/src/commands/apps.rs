use std::path::PathBuf;
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub name: String,
    pub icon: String,
    pub exec: String,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendedApp {
    pub name: String,
    pub icon: Option<String>,
    pub exec: String,
    pub path: String,
}

static APPS_CACHE: OnceLock<Vec<AppEntry>> = OnceLock::new();

pub fn split_exec_args(exec: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut has_token = false;

    for c in exec.chars() {
        if c == '"' {
            in_quotes = !in_quotes;
            has_token = true;
        } else if c.is_whitespace() && !in_quotes {
            if has_token {
                tokens.push(current);
                current = String::new();
                has_token = false;
            }
        } else {
            current.push(c);
            has_token = true;
        }
    }

    if has_token {
        tokens.push(current);
    }

    tokens.retain(|tok| !matches!(tok.as_str(), "%f" | "%F" | "%u" | "%U" | "%i" | "%k" | "%c"));
    tokens
}

pub fn scan_apps_in_dirs(dirs: &[PathBuf]) -> Vec<AppEntry> {
    let mut apps: Vec<AppEntry> = Vec::new();

    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_path = entry.path();
            if file_path.extension().and_then(|ext| ext.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&file_path) else {
                continue;
            };
            if let Some(entry) = crate::desktop_entry::parse_desktop_entry(&content, None) {
                if !entry.no_display {
                    apps.push(AppEntry {
                        name: entry.name,
                        icon: entry.icon.unwrap_or_default(),
                        exec: entry.exec,
                    });
                }
            }
        }
    }

    apps.sort_by(|a, b| a.name.cmp(&b.name));
    apps
}

pub fn scan_recommended_apps_in_dirs(dirs: &[PathBuf], mime: &str) -> Vec<RecommendedApp> {
    let mut apps: Vec<RecommendedApp> = Vec::new();

    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_path = entry.path();
            if file_path.extension().and_then(|ext| ext.to_str()) != Some("desktop") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&file_path) else {
                continue;
            };
            let path_str = file_path.to_string_lossy().into_owned();
            if let Some(entry) = crate::desktop_entry::parse_desktop_entry(&content, Some(&path_str)) {
                if !entry.no_display && crate::desktop_entry::matches_mime(&entry.mime_types, mime) {
                    apps.push(RecommendedApp {
                        name: entry.name,
                        icon: entry.icon,
                        exec: entry.exec,
                        path: path_str,
                    });
                }
            }
        }
    }

    apps
}

pub fn query_mime_type(path: &str) -> Option<String> {
    let output = std::process::Command::new("xdg-mime")
        .args(["query", "filetype", path])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mime = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if mime.is_empty() {
        None
    } else {
        Some(mime)
    }
}

pub fn spawn_open_with(exec: &str, path: &str) -> bool {
    let tokens = split_exec_args(exec);
    if tokens.is_empty() {
        return false;
    }
    let cmd = &tokens[0];
    if cmd.is_empty() {
        return false;
    }
    let args = &tokens[1..];

    let mut command = std::process::Command::new(cmd);
    command.args(args);
    command.arg(path);
    command.stdin(std::process::Stdio::null());
    command.stdout(std::process::Stdio::null());
    command.stderr(std::process::Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    command.spawn().is_ok()
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_apps() -> Vec<AppEntry> {
    APPS_CACHE
        .get_or_init(|| {
            let mut dirs = vec![
                PathBuf::from("/usr/share/applications"),
                PathBuf::from("/usr/local/share/applications"),
            ];
            if let Some(home) = dirs::home_dir() {
                dirs.push(home.join(".local/share/applications"));
            }
            scan_apps_in_dirs(&dirs)
        })
        .clone()
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_recommended_apps(path: String) -> Vec<RecommendedApp> {
    let Some(mime) = query_mime_type(&path) else {
        return Vec::new();
    };

    let mut dirs = vec![PathBuf::from("/usr/share/applications")];
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/share/applications"));
    }
    dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/share/flatpak/exports/share/applications"));
    }

    scan_recommended_apps_in_dirs(&dirs, &mime)
}

#[tauri::command(rename_all = "camelCase")]
pub fn open_with(exec: String, path: String) -> bool {
    spawn_open_with(&exec, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_split_exec_args_simple() {
        assert_eq!(split_exec_args("gedit"), vec!["gedit"]);
        assert_eq!(
            split_exec_args("code --unity-launch"),
            vec!["code", "--unity-launch"]
        );
    }

    #[test]
    fn test_split_exec_args_with_quotes() {
        let cmd = r#""/path with spaces/my app" --title="hello world" "normal arg""#;
        assert_eq!(
            split_exec_args(cmd),
            vec![
                "/path with spaces/my app",
                "--title=hello world",
                "normal arg"
            ]
        );
    }

    #[test]
    fn test_split_exec_args_strips_leftover_placeholders() {
        let cmd = "my-app --flag %F %u %f %U %i %k %c arg";
        assert_eq!(split_exec_args(cmd), vec!["my-app", "--flag", "arg"]);
    }

    #[test]
    fn test_split_exec_args_empty_or_whitespace() {
        assert!(split_exec_args("").is_empty());
        assert!(split_exec_args("   \t  \n ").is_empty());
        assert!(split_exec_args("%f %U").is_empty());
    }

    #[test]
    fn test_scan_apps_in_dirs_skips_hidden_and_sorts_by_name() {
        let dir = tempdir().unwrap();
        let dpath = dir.path();

        let app_b = dpath.join("b_app.desktop");
        std::fs::write(
            &app_b,
            "[Desktop Entry]\nName=Bravo\nExec=bravo %u\nIcon=bravo-icon\n",
        )
        .unwrap();

        let app_a = dpath.join("a_app.desktop");
        std::fs::write(&app_a, "[Desktop Entry]\nName=Alpha\nExec=alpha\n").unwrap();

        let hidden = dpath.join("hidden.desktop");
        std::fs::write(
            &hidden,
            "[Desktop Entry]\nName=Hidden\nExec=hidden\nNoDisplay=true\n",
        )
        .unwrap();

        let non_desktop = dpath.join("other.txt");
        std::fs::write(&non_desktop, "Some content").unwrap();

        let apps = scan_apps_in_dirs(&[dpath.to_path_buf()]);
        assert_eq!(apps.len(), 2);
        assert_eq!(
            apps[0],
            AppEntry {
                name: "Alpha".to_string(),
                icon: "".to_string(),
                exec: "alpha".to_string(),
            }
        );
        assert_eq!(
            apps[1],
            AppEntry {
                name: "Bravo".to_string(),
                icon: "bravo-icon".to_string(),
                exec: "bravo".to_string(),
            }
        );
    }

    #[test]
    fn test_scan_recommended_apps_in_dirs() {
        let dir = tempdir().unwrap();
        let dpath = dir.path();

        let text_app = dpath.join("editor.desktop");
        std::fs::write(
            &text_app,
            "[Desktop Entry]\nName=TextEditor\nExec=editor %f\nIcon=editor-icon\nMimeType=text/plain;\n",
        )
        .unwrap();

        let img_app = dpath.join("viewer.desktop");
        std::fs::write(
            &img_app,
            "[Desktop Entry]\nName=ImageViewer\nExec=viewer %f\nMimeType=image/png;image/jpeg;\n",
        )
        .unwrap();

        let hidden_app = dpath.join("hidden_editor.desktop");
        std::fs::write(
            &hidden_app,
            "[Desktop Entry]\nName=SecretEditor\nExec=secret %f\nNoDisplay=true\nMimeType=text/plain;\n",
        )
        .unwrap();

        let text_matches = scan_recommended_apps_in_dirs(&[dpath.to_path_buf()], "text/plain");
        assert_eq!(text_matches.len(), 1);
        assert_eq!(text_matches[0].name, "TextEditor");
        assert_eq!(text_matches[0].icon.as_deref(), Some("editor-icon"));
        assert_eq!(text_matches[0].exec, "editor");
        assert_eq!(text_matches[0].path, text_app.to_string_lossy());

        let img_matches = scan_recommended_apps_in_dirs(&[dpath.to_path_buf()], "image/png");
        assert_eq!(img_matches.len(), 1);
        assert_eq!(img_matches[0].name, "ImageViewer");
        assert_eq!(img_matches[0].icon, None);

        let none_matches = scan_recommended_apps_in_dirs(&[dpath.to_path_buf()], "audio/mp3");
        assert!(none_matches.is_empty());
    }

    #[test]
    fn test_spawn_open_with() {
        assert!(!spawn_open_with("", "/some/path"));
        assert!(!spawn_open_with("%f", "/some/path"));
        assert!(!spawn_open_with(
            "/definitely/nonexistent/binary_xyz_12345",
            "/some/path"
        ));

        // "true" is standard POSIX executable that succeeds immediately
        assert!(spawn_open_with("true", "/some/dummy/path"));
        // "true" with arguments and leftover %f placeholder
        assert!(spawn_open_with("true --dummy %f", "/some/dummy/path"));
    }
}
