use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractProgressPayload {
    pub path: String,
    pub archive_name: String,
    pub current_file: String,
    pub extracted_count: usize,
    pub total_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn resolve_dir_and_ext(file: &str) -> Option<(String, String)> {
    let path = Path::new(file);
    let dir = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_string_lossy().into_owned(),
        _ => ".".to_string(),
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())?;

    Some((dir, ext))
}

fn build_extract_command(
    file: &str,
    dest_dir: Option<&str>,
    verbose: bool,
) -> Option<(String, Vec<String>)> {
    let (parent_dir, ext) = resolve_dir_and_ext(file)?;
    let dir = dest_dir
        .filter(|d| !d.trim().is_empty())
        .map(|d| d.to_string())
        .unwrap_or(parent_dir);

    match ext.as_str() {
        "zip" => Some((
            "unzip".to_string(),
            vec!["-o".to_string(), file.to_string(), "-d".to_string(), dir],
        )),
        "tar" | "gz" | "xz" | "tgz" => {
            let flag = if verbose { "-xvf" } else { "-xf" };
            Some((
                "tar".to_string(),
                vec![flag.to_string(), file.to_string(), "-C".to_string(), dir],
            ))
        }
        "rar" => {
            let rar_dir = if dir.ends_with('/') {
                dir
            } else {
                format!("{}/", dir)
            };
            Some((
                "unrar".to_string(),
                vec![
                    "x".to_string(),
                    "-o+".to_string(),
                    "-p-".to_string(),
                    file.to_string(),
                    rar_dir,
                ],
            ))
        }
        _ => None,
    }
}

pub fn extract_command_to(file: &str, dest_dir: Option<&str>) -> Option<(String, Vec<String>)> {
    build_extract_command(file, dest_dir, false)
}

pub fn extract_command(file: &str) -> Option<(String, Vec<String>)> {
    extract_command_to(file, None)
}

pub fn list_entries_command(file: &str) -> Option<(String, Vec<String>)> {
    let (_, ext) = resolve_dir_and_ext(file)?;

    match ext.as_str() {
        "zip" => Some(("unzip".to_string(), vec!["-Z1".to_string(), file.to_string()])),
        "tar" | "gz" | "xz" | "tgz" => {
            Some(("tar".to_string(), vec!["-tf".to_string(), file.to_string()]))
        }
        "rar" => Some((
            "unrar".to_string(),
            vec!["lb".to_string(), "-p-".to_string(), file.to_string()],
        )),
        _ => None,
    }
}

pub fn extract_verbose_command_to(
    file: &str,
    dest_dir: Option<&str>,
) -> Option<(String, Vec<String>)> {
    build_extract_command(file, dest_dir, true)
}

pub fn extract_verbose_command(file: &str) -> Option<(String, Vec<String>)> {
    extract_verbose_command_to(file, None)
}

pub fn is_password_error(output: &str) -> bool {
    let lower = output.to_ascii_lowercase();
    lower.contains("specified password is incorrect")
        || lower.contains("enter password (will not be echoed)")
        || lower.contains("incorrect password")
        || lower.contains("wrong password")
        || lower.contains("password is required")
}

fn format_extract_failure_message(
    status_display: &str,
    stderr_text: &str,
    stdout_had_password_error: bool,
) -> String {
    if stdout_had_password_error || is_password_error(stderr_text) {
        return "ARCHIVE_PASSWORD_REQUIRED: This archive is password-protected.".to_string();
    }
    let trimmed_err = stderr_text.trim();
    if trimmed_err.is_empty() {
        format!("Extraction exited with status {}", status_display)
    } else {
        trimmed_err.to_string()
    }
}

pub fn parse_extracted_entry_line(cmd: &str, line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    match cmd {
        "unzip" => {
            let lower = trimmed.to_ascii_lowercase();
            for prefix in ["inflating:", "extracting:", "creating:", "linking:"] {
                if lower.starts_with(prefix) {
                    let rest = trimmed[prefix.len()..].trim();
                    if !rest.is_empty() {
                        return Some(rest.to_string());
                    }
                    return None;
                }
            }
            None
        }
        "tar" => Some(trimmed.to_string()),
        "unrar" => {
            for prefix in ["Extracting ", "Creating "] {
                if let Some(rest) = trimmed.strip_prefix(prefix) {
                    if let Some(before_ok) = rest.strip_suffix("OK") {
                        if before_ok.chars().last().is_some_and(|c| c.is_whitespace()) {
                            let entry = before_ok.trim();
                            if !entry.is_empty() {
                                return Some(entry.to_string());
                            }
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn count_archive_entries(file: &str) -> usize {
    let Some((list_cmd, list_args)) = list_entries_command(file) else {
        return 0;
    };
    let Ok(output) = Command::new(&list_cmd)
        .args(&list_args)
        .stdin(Stdio::null())
        .output()
    else {
        return 0;
    };
    if !output.status.success() {
        return 0;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
}

pub fn extract_file_with_progress_to<F>(
    file: &str,
    dest_dir: Option<&str>,
    on_progress: F,
) -> Result<bool, String>
where
    F: FnMut(ExtractProgressPayload),
{
    let Some((cmd, args)) = extract_verbose_command_to(file, dest_dir) else {
        return Ok(false);
    };

    if let Some(dir) = dest_dir.filter(|d| !d.trim().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }

    let total_count = count_archive_entries(file);
    extract_with_command(file, &cmd, &args, total_count, on_progress)
}

pub fn extract_file_with_progress<F>(file: &str, on_progress: F) -> Result<bool, String>
where
    F: FnMut(ExtractProgressPayload),
{
    extract_file_with_progress_to(file, None, on_progress)
}

pub fn extract_with_command<F>(
    file: &str,
    cmd: &str,
    args: &[String],
    total_count: usize,
    on_progress: F,
) -> Result<bool, String>
where
    F: FnMut(ExtractProgressPayload),
{
    crate::archive_tools::run_progress_command(
        file,
        cmd,
        args,
        None,
        total_count,
        |line| parse_extracted_entry_line(cmd, line),
        is_password_error,
        format_extract_failure_message,
        on_progress,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_extract_command_zip_with_shell_characters() {
        let file = "/tmp/my \"archive\" $(whoami).zip";
        let (cmd, args) = extract_command(file).expect("should return extract command for zip");
        assert_eq!(cmd, "unzip");
        assert_eq!(args, vec!["-o", file, "-d", "/tmp"]);
    }

    #[test]
    fn test_extract_command_tar_formats() {
        for ext in [".tar", ".tar.gz", ".gz", ".tar.xz", ".xz", ".tgz"] {
            let file = format!("/home/user/archive{}", ext);
            let (cmd, args) = extract_command(&file)
                .unwrap_or_else(|| panic!("should return extract command for {}", ext));
            assert_eq!(cmd, "tar");
            assert_eq!(args, vec!["-xf", file.as_str(), "-C", "/home/user"]);
        }
    }

    #[test]
    fn test_extract_command_unsupported_extensions() {
        assert_eq!(extract_command("/home/user/notes.txt"), None);
        assert_eq!(extract_command("/home/user/no_extension"), None);
    }

    #[test]
    fn test_extract_command_rar_with_shell_characters() {
        let file = "/tmp/my \"archive\" $(whoami).rar";
        let (cmd, args) =
            extract_command_to(file, None).expect("should return extract command for rar");
        assert_eq!(cmd, "unrar");
        assert_eq!(args, vec!["x", "-o+", "-p-", file, "/tmp/"]);
    }

    #[test]
    fn test_extract_command_custom_dest_dir() {
        let (zip_cmd, zip_args) =
            extract_command_to("/tmp/a.zip", Some("/tmp/out")).expect("zip with dest_dir");
        assert_eq!(zip_cmd, "unzip");
        assert_eq!(zip_args, vec!["-o", "/tmp/a.zip", "-d", "/tmp/out"]);

        let (rar_cmd, rar_args) =
            extract_command_to("/tmp/a.rar", Some("/tmp/out")).expect("rar with dest_dir");
        assert_eq!(rar_cmd, "unrar");
        assert_eq!(
            rar_args,
            vec!["x", "-o+", "-p-", "/tmp/a.rar", "/tmp/out/"]
        );

        let (rar_slash_cmd, rar_slash_args) =
            extract_command_to("/tmp/a.RAR", Some("/tmp/out/")).expect("RAR with trailing slash");
        assert_eq!(rar_slash_cmd, "unrar");
        assert_eq!(
            rar_slash_args,
            vec!["x", "-o+", "-p-", "/tmp/a.RAR", "/tmp/out/"]
        );

        let (tar_cmd, tar_args) =
            extract_verbose_command_to("/tmp/a.tar", Some("/tmp/out")).expect("tar verbose dest");
        assert_eq!(tar_cmd, "tar");
        assert_eq!(tar_args, vec!["-xvf", "/tmp/a.tar", "-C", "/tmp/out"]);
    }

    #[test]
    fn test_format_extract_failure_message_password_required() {
        assert_eq!(
            format_extract_failure_message("exit status: 11", "The specified password is incorrect.\n", false),
            "ARCHIVE_PASSWORD_REQUIRED: This archive is password-protected."
        );
        assert_eq!(
            format_extract_failure_message("exit status: 11", "", true),
            "ARCHIVE_PASSWORD_REQUIRED: This archive is password-protected."
        );
        assert_eq!(
            format_extract_failure_message("exit status: 2", "CRC failed", false),
            "CRC failed"
        );
        assert_eq!(
            format_extract_failure_message("exit status: 2", "   ", false),
            "Extraction exited with status exit status: 2"
        );
    }

    #[test]
    fn test_list_entries_command_rar() {
        assert_eq!(
            list_entries_command("/tmp/a.rar"),
            Some((
                "unrar".to_string(),
                vec!["lb".to_string(), "-p-".to_string(), "/tmp/a.rar".to_string()]
            ))
        );
    }

    #[cfg(unix)]
    #[test]
    fn test_extract_with_command_returns_err_on_password_error() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir().expect("create tempdir");
        let script = dir.path().join("fake_unrar.sh");
        std::fs::write(
            &script,
            "#!/bin/sh\necho \"The specified password is incorrect.\" >&2\nexit 11\n",
        )
        .expect("write fake unrar script");
        let mut perms = std::fs::metadata(&script).expect("metadata").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).expect("chmod +x");

        let mut events = Vec::new();
        let res = extract_with_command(
            "/tmp/secret.rar",
            script.to_str().unwrap(),
            &[],
            1,
            |ev| events.push(ev),
        );
        let err_msg = res.expect_err("password-protected archive should return Err");
        assert!(
            err_msg.contains("ARCHIVE_PASSWORD_REQUIRED"),
            "expected ARCHIVE_PASSWORD_REQUIRED, got: {}",
            err_msg
        );
        let last = events.last().expect("done event on password error");
        assert!(last.done);
        assert_eq!(last.error.as_deref(), Some(err_msg.as_str()));
    }

    #[test]
    fn test_parse_extracted_entry_line_unrar() {
        assert_eq!(
            parse_extracted_entry_line("unrar", "Extracting  folder/file.txt     OK"),
            Some("folder/file.txt".to_string())
        );
        assert_eq!(
            parse_extracted_entry_line("unrar", "Creating    folder                    OK"),
            Some("folder".to_string())
        );
        assert_eq!(
            parse_extracted_entry_line("unrar", "UNRAR 7.00 freeware"),
            None
        );
        assert_eq!(
            parse_extracted_entry_line("unrar", "Extracting from /tmp/a.rar"),
            None
        );
    }

    #[test]
    fn test_is_password_error_detects_encrypted_rar() {
        assert!(is_password_error("The specified password is incorrect."));
        assert!(is_password_error("Enter password (will not be echoed)"));
        assert!(!is_password_error("Extracting  folder/file.txt     OK"));
    }

    #[test]
    fn test_extract_file_with_progress_to_creates_dest_dir() {
        let dir = tempdir().expect("create tempdir");
        let src_file = dir.path().join("hello.txt");
        std::fs::write(&src_file, "hello dest").expect("write test file");

        let tar_file = dir.path().join("archive.tar");
        let status = std::process::Command::new("tar")
            .arg("-cf")
            .arg(&tar_file)
            .arg("-C")
            .arg(dir.path())
            .arg("hello.txt")
            .status()
            .expect("tar create");
        assert!(status.success());

        let nested_dest = dir.path().join("sub").join("out");
        assert!(!nested_dest.exists());

        let mut events = Vec::new();
        let ok = extract_file_with_progress_to(
            tar_file.to_str().unwrap(),
            Some(nested_dest.to_str().unwrap()),
            |ev| events.push(ev),
        )
        .expect("extract to custom dest_dir");
        assert!(ok);
        assert!(nested_dest.join("hello.txt").exists());
        assert_eq!(
            std::fs::read_to_string(nested_dest.join("hello.txt")).unwrap(),
            "hello dest"
        );
    }

    #[test]
    fn test_extract_command_case_insensitive() {
        let file = "/tmp/my_archive.ZIP";
        let (cmd, args) = extract_command(file).expect("should handle .ZIP uppercase");
        assert_eq!(cmd, "unzip");
        assert_eq!(args, vec!["-o", file, "-d", "/tmp"]);

        let file_tgz = "/tmp/archive.TGZ";
        let (cmd2, args2) = extract_command(file_tgz).expect("should handle .TGZ uppercase");
        assert_eq!(cmd2, "tar");
        assert_eq!(args2, vec!["-xf", file_tgz, "-C", "/tmp"]);
    }

    #[test]
    fn test_extract_command_relative_no_dir() {
        let file = "archive.zip";
        let (cmd, args) = extract_command(file).expect("should handle relative zip");
        assert_eq!(cmd, "unzip");
        assert_eq!(args, vec!["-o", file, "-d", "."]);
    }

    #[test]
    fn test_parse_extracted_entry_line_unzip_and_tar() {
        assert_eq!(parse_extracted_entry_line("unzip", "Archive:  /tmp/test.zip"), None);
        assert_eq!(
            parse_extracted_entry_line("unzip", "caution: filename not matched"),
            None
        );
        assert_eq!(
            parse_extracted_entry_line("unzip", "  inflating: folder/file.txt  "),
            Some("folder/file.txt".to_string())
        );
        assert_eq!(
            parse_extracted_entry_line("unzip", "   creating: folder/"),
            Some("folder/".to_string())
        );
        assert_eq!(
            parse_extracted_entry_line("tar", "folder/file.txt\n"),
            Some("folder/file.txt".to_string())
        );
    }

    #[test]
    fn test_extract_file_with_progress_zero_entries_tar_uses_none_percent() {
        let dir = tempdir().expect("create tempdir");
        let empty_tar = dir.path().join("empty.tar");
        let status = std::process::Command::new("tar")
            .arg("-cf")
            .arg(&empty_tar)
            .arg("--files-from")
            .arg("/dev/null")
            .status()
            .expect("tar create empty");
        assert!(status.success());

        let mut events = Vec::new();
        let ok = extract_file_with_progress(empty_tar.to_str().unwrap(), |ev| events.push(ev))
            .expect("extract empty tar");
        assert!(ok);
        assert!(!events.is_empty());
        assert_eq!(events[0].total_count, 0);
        assert_eq!(events[0].percent, None);
        assert_eq!(events.last().unwrap().done, true);
    }

    #[test]
    fn test_extract_progress_payload_skips_none_fields() {
        let payload = ExtractProgressPayload {
            path: "/tmp/empty.tar".to_string(),
            archive_name: "empty.tar".to_string(),
            current_file: String::new(),
            extracted_count: 0,
            total_count: 0,
            percent: None,
            done: false,
            error: None,
        };
        let json = serde_json::to_value(&payload).expect("serialize ExtractProgressPayload");
        assert!(json.get("percent").is_none());
        assert!(json.get("error").is_none());
    }

    #[test]
    fn test_extract_with_command_emits_done_error_on_spawn_failure() {
        let mut events = Vec::new();
        let res = extract_with_command(
            "/tmp/archive.zip",
            "__definitely_nonexistent_extract_binary_xyz__",
            &[],
            3,
            |ev| events.push(ev),
        );
        let err_msg = res.expect_err("nonexistent binary should error");
        assert!(
            err_msg.starts_with("MISSING_TOOL:"),
            "expected MISSING_TOOL: prefix, got: {}",
            err_msg
        );
        let payload: serde_json::Value =
            serde_json::from_str(err_msg.strip_prefix("MISSING_TOOL:").unwrap())
                .expect("valid MISSING_TOOL JSON");
        assert_eq!(payload["tool"], "__definitely_nonexistent_extract_binary_xyz__");
        assert!(payload.get("distroName").is_some());
        assert!(payload.get("installCommand").is_some());

        let last = events.last().expect("done event on spawn failure");
        assert!(last.done);
        assert_eq!(last.error.as_deref(), Some(err_msg.as_str()));
    }
}
