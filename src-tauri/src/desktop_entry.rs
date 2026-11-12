#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopEntry {
    pub name: String,
    pub icon: Option<String>,
    pub exec: String,
    pub no_display: bool,
    pub mime_types: Vec<String>,
    pub path: Option<String>,
}

fn get_main_desktop_section(content: &str) -> &str {
    let section_start = if let Some(idx) = content.find("[Desktop Entry]") {
        idx + "[Desktop Entry]".len()
    } else {
        0
    };
    let rest = &content[section_start..];

    // Find next section header starting with newline followed by `[`
    let mut search_idx = 0;
    while let Some(pos) = rest[search_idx..].find("\n[") {
        let abs_pos = search_idx + pos;
        let line_rest = &rest[abs_pos + 2..]; // after "\n["
        if let Some(bracket_end) = line_rest.find(']') {
            let header_inside = &line_rest[..bracket_end];
            if !header_inside.contains('\n') && !header_inside.is_empty() {
                return &rest[..abs_pos];
            }
        }
        search_idx = abs_pos + 1;
    }
    rest
}

pub fn clean_exec(raw: &str) -> String {
    let mut chars = raw.chars().peekable();
    let mut cleaned = String::with_capacity(raw.len());
    while let Some(c) = chars.next() {
        if c == '%' {
            if let Some(&next) = chars.peek() {
                if matches!(next, 'f' | 'F' | 'u' | 'U' | 'i' | 'k' | 'c') {
                    chars.next(); // consume the placeholder char
                    continue;
                }
            }
        }
        cleaned.push(c);
    }
    cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse_desktop_entry(content: &str, file_path: Option<&str>) -> Option<DesktopEntry> {
    let section = get_main_desktop_section(content);

    let mut name: Option<&str> = None;
    let mut exec: Option<&str> = None;
    let mut icon: Option<&str> = None;
    let mut no_display: Option<&str> = None;
    let mut mime_type: Option<&str> = None;

    for line in section.lines() {
        let line = line.trim_end_matches('\r');
        if name.is_none() && line.starts_with("Name=") {
            name = Some(&line[5..]);
        } else if exec.is_none() && line.starts_with("Exec=") {
            exec = Some(&line[5..]);
        } else if icon.is_none() && line.starts_with("Icon=") {
            icon = Some(&line[5..]);
        } else if no_display.is_none() && line.starts_with("NoDisplay=") {
            no_display = Some(&line[10..]);
        } else if mime_type.is_none() && line.starts_with("MimeType=") {
            mime_type = Some(&line[9..]);
        }
    }

    let (raw_name, raw_exec) = match (name, exec) {
        (Some(n), Some(e)) => (n.trim(), e),
        _ => return None,
    };

    if raw_name.is_empty() {
        return None;
    }

    let cleaned_exec = clean_exec(raw_exec);
    if cleaned_exec.is_empty() {
        return None;
    }

    let icon = icon
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let no_display = no_display
        .map(|s| s.trim().eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    let mime_types = mime_type
        .map(|s| {
            s.split(';')
                .map(|m| m.trim().to_string())
                .filter(|m| !m.is_empty())
                .collect()
        })
        .unwrap_or_default();

    Some(DesktopEntry {
        name: raw_name.to_string(),
        icon,
        exec: cleaned_exec,
        no_display,
        mime_types,
        path: file_path.map(|p| p.to_string()),
    })
}

pub fn matches_mime(entry_mime_types: &[String], target: &str) -> bool {
    let normalized_target = target.trim().to_ascii_lowercase();
    if normalized_target.is_empty() {
        return false;
    }

    entry_mime_types.iter().any(|mime| {
        let norm = mime.trim().to_ascii_lowercase();
        if norm == normalized_target {
            return true;
        }
        if let Some(prefix) = norm.strip_suffix("/*") {
            if prefix == "*" {
                return normalized_target.contains('/');
            }
            if let Some((target_type, _)) = normalized_target.split_once('/') {
                if target_type == prefix {
                    return true;
                }
            }
        }
        false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_DESKTOP: &str = r#"
[Desktop Entry]
Name=Visual Studio Code
Exec=/usr/share/code/code --unity-launch %F
Icon=vscode
Type=Application
NoDisplay=false
MimeType=text/plain;inode/directory;application/x-code-workspace;
"#;

    #[test]
    fn test_parses_name_icon_cleaned_exec_no_display_and_mime_type_list() {
        let parsed = parse_desktop_entry(SAMPLE_DESKTOP, Some("/usr/share/applications/code.desktop"));
        assert_eq!(
            parsed,
            Some(DesktopEntry {
                name: "Visual Studio Code".to_string(),
                icon: Some("vscode".to_string()),
                exec: "/usr/share/code/code --unity-launch".to_string(),
                no_display: false,
                mime_types: vec![
                    "text/plain".to_string(),
                    "inode/directory".to_string(),
                    "application/x-code-workspace".to_string(),
                ],
                path: Some("/usr/share/applications/code.desktop".to_string()),
            })
        );
    }

    #[test]
    fn test_marks_no_display_true_entries_accurately() {
        let hidden = "[Desktop Entry]\nName=HiddenHelper\nExec=helper %u\nNoDisplay=true\n";
        assert_eq!(
            parse_desktop_entry(hidden, None).map(|e| e.no_display),
            Some(true)
        );
    }

    #[test]
    fn test_matches_exact_mime_type_from_parsed_list() {
        let mimes = vec!["text/plain".to_string(), "image/png".to_string()];
        assert!(matches_mime(&mimes, "image/png"));
        assert!(!matches_mime(&mimes, "image/jpeg"));
    }

    #[test]
    fn test_stops_at_next_section_header() {
        let with_action = r#"
[Desktop Entry]
Name=MainApp
Exec=main %f
Icon=main-icon

[Desktop Action new-window]
Name=ActionApp
Exec=action %f
"#;
        let parsed = parse_desktop_entry(with_action, None).unwrap();
        assert_eq!(parsed.name, "MainApp");
        assert_eq!(parsed.exec, "main");
        assert_eq!(parsed.icon.as_deref(), Some("main-icon"));
    }

    #[test]
    fn test_missing_name_or_exec_returns_none() {
        let no_exec = "[Desktop Entry]\nName=NoExec\nIcon=icon\n";
        assert_eq!(parse_desktop_entry(no_exec, None), None);

        let no_name = "[Desktop Entry]\nExec=app\n";
        assert_eq!(parse_desktop_entry(no_name, None), None);

        let empty_name = "[Desktop Entry]\nName=   \nExec=app\n";
        assert_eq!(parse_desktop_entry(empty_name, None), None);
    }

    #[test]
    fn test_exec_cleaned_empty_returns_none() {
        let exec_only_placeholders = "[Desktop Entry]\nName=App\nExec=%f %u\n";
        assert_eq!(parse_desktop_entry(exec_only_placeholders, None), None);
    }

    #[test]
    fn test_clean_exec_collapses_whitespace_and_removes_all_placeholders() {
        assert_eq!(
            clean_exec("/usr/bin/app  --flag   %f  %F %u %U %i %k %c  trailing"),
            "/usr/bin/app --flag trailing"
        );
        assert_eq!(clean_exec("app %% %v"), "app %% %v");
    }

    #[test]
    fn test_matches_mime_wildcard_and_empty() {
        let mimes = vec!["image/*".to_string(), "text/plain".to_string()];
        assert!(matches_mime(&mimes, "image/png"));
        assert!(matches_mime(&mimes, "image/jpeg"));
        assert!(!matches_mime(&mimes, "video/mp4"));
        assert!(!matches_mime(&mimes, ""));
        assert!(!matches_mime(&mimes, "   "));

        let star_all = vec!["*/*".to_string()];
        assert!(matches_mime(&star_all, "application/pdf"));
    }
}
