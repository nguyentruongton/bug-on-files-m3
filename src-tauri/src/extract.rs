use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtractProgressPayload {
    pub path: String,
    pub archive_name: String,
    pub current_file: String,
    pub extracted_count: usize,
    pub total_count: usize,
    pub percent: Option<f64>,
    pub done: bool,
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

pub fn extract_command(file: &str) -> Option<(String, Vec<String>)> {
    let (dir, ext) = resolve_dir_and_ext(file)?;

    match ext.as_str() {
        "zip" => Some((
            "unzip".to_string(),
            vec!["-o".to_string(), file.to_string(), "-d".to_string(), dir],
        )),
        "tar" | "gz" | "xz" | "tgz" => Some((
            "tar".to_string(),
            vec!["-xf".to_string(), file.to_string(), "-C".to_string(), dir],
        )),
        _ => None,
    }
}

pub fn list_entries_command(file: &str) -> Option<(String, Vec<String>)> {
    let (_, ext) = resolve_dir_and_ext(file)?;

    match ext.as_str() {
        "zip" => Some(("unzip".to_string(), vec!["-Z1".to_string(), file.to_string()])),
        "tar" | "gz" | "xz" | "tgz" => {
            Some(("tar".to_string(), vec!["-tf".to_string(), file.to_string()]))
        }
        _ => None,
    }
}

pub fn extract_verbose_command(file: &str) -> Option<(String, Vec<String>)> {
    let (dir, ext) = resolve_dir_and_ext(file)?;

    match ext.as_str() {
        "zip" => Some((
            "unzip".to_string(),
            vec!["-o".to_string(), file.to_string(), "-d".to_string(), dir],
        )),
        "tar" | "gz" | "xz" | "tgz" => Some((
            "tar".to_string(),
            vec!["-xvf".to_string(), file.to_string(), "-C".to_string(), dir],
        )),
        _ => None,
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
        _ => None,
    }
}

fn compute_percent(extracted: usize, total: usize) -> Option<f64> {
    if total > 0 {
        Some(((extracted as f64 / total as f64) * 100.0).min(100.0))
    } else {
        None
    }
}

fn count_archive_entries(file: &str) -> usize {
    let Some((list_cmd, list_args)) = list_entries_command(file) else {
        return 0;
    };
    let Ok(output) = Command::new(&list_cmd).args(&list_args).output() else {
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

pub fn extract_file_with_progress<F>(file: &str, mut on_progress: F) -> Result<bool, String>
where
    F: FnMut(ExtractProgressPayload),
{
    let Some((cmd, args)) = extract_verbose_command(file) else {
        return Ok(false);
    };

    let archive_name = Path::new(file)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file)
        .to_string();
    let total_count = count_archive_entries(file);

    on_progress(ExtractProgressPayload {
        path: file.to_string(),
        archive_name: archive_name.clone(),
        current_file: String::new(),
        extracted_count: 0,
        total_count,
        percent: compute_percent(0, total_count),
        done: false,
        error: None,
    });

    let mut child = Command::new(&cmd)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| err.to_string())?;

    let stderr_handle = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = stderr.read_to_string(&mut buf);
            buf
        })
    });

    let mut extracted_count: usize = 0;
    let mut last_entry = String::new();
    let mut last_emit = Instant::now();

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line_res in reader.lines() {
            let Ok(line) = line_res else {
                continue;
            };
            if let Some(entry) = parse_extracted_entry_line(&cmd, &line) {
                extracted_count += 1;
                last_entry = entry.clone();
                let is_boundary = extracted_count == 1
                    || (total_count > 0 && extracted_count == total_count);
                if is_boundary || last_emit.elapsed() >= Duration::from_millis(40) {
                    on_progress(ExtractProgressPayload {
                        path: file.to_string(),
                        archive_name: archive_name.clone(),
                        current_file: entry,
                        extracted_count,
                        total_count,
                        percent: compute_percent(extracted_count, total_count),
                        done: false,
                        error: None,
                    });
                    last_emit = Instant::now();
                }
            }
        }
    }

    let status = child.wait().map_err(|err| err.to_string())?;
    let stderr_text = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();

    if status.success() {
        on_progress(ExtractProgressPayload {
            path: file.to_string(),
            archive_name,
            current_file: last_entry,
            extracted_count,
            total_count,
            percent: Some(100.0),
            done: true,
            error: None,
        });
        Ok(true)
    } else {
        let trimmed_err = stderr_text.trim().to_string();
        let err_msg = if trimmed_err.is_empty() {
            format!("Extraction exited with status {}", status)
        } else {
            trimmed_err
        };
        on_progress(ExtractProgressPayload {
            path: file.to_string(),
            archive_name,
            current_file: last_entry,
            extracted_count,
            total_count,
            percent: compute_percent(extracted_count, total_count),
            done: true,
            error: Some(err_msg),
        });
        Ok(false)
    }
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
        assert_eq!(extract_command("/home/user/archive.rar"), None);
        assert_eq!(extract_command("/home/user/no_extension"), None);
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
}
