use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::extract::ExtractProgressPayload;

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MissingToolInfo {
    pub tool: String,
    pub package: String,
    pub distro_name: String,
    pub install_command: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DistroFamily {
    Arch,
    Debian,
    Fedora,
    OpenSuse,
}

fn unquote_os_release_value(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
    } else {
        trimmed.to_string()
    }
}

fn detect_distro_family(id: &str, id_like: &str) -> Option<DistroFamily> {
    let id_lower = id.to_ascii_lowercase();
    let id_like_lower = id_like.to_ascii_lowercase();
    for token in std::iter::once(id_lower.as_str()).chain(id_like_lower.split_whitespace()) {
        if matches!(
            token,
            "arch" | "manjaro" | "endeavouros" | "cachyos" | "garuda" | "artix"
        ) {
            return Some(DistroFamily::Arch);
        }
        if matches!(
            token,
            "ubuntu" | "debian" | "linuxmint" | "pop" | "elementary" | "zorin" | "raspbian"
        ) {
            return Some(DistroFamily::Debian);
        }
        if matches!(token, "fedora" | "rhel" | "centos" | "rocky" | "almalinux") {
            return Some(DistroFamily::Fedora);
        }
        if token.starts_with("opensuse") || matches!(token, "suse" | "sles") {
            return Some(DistroFamily::OpenSuse);
        }
    }
    None
}

fn package_for_tool(tool: &str) -> &str {
    tool
}

pub fn parse_os_release_and_command(os_release_content: &str, tool: &str) -> MissingToolInfo {
    let mut id = String::new();
    let mut id_like = String::new();
    let mut pretty_name = String::new();
    let mut name = String::new();

    for line in os_release_content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, raw_val)) = trimmed.split_once('=') else {
            continue;
        };
        let value = unquote_os_release_value(raw_val);
        match key.trim() {
            "ID" => id = value,
            "ID_LIKE" => id_like = value,
            "PRETTY_NAME" => pretty_name = value,
            "NAME" => name = value,
            _ => {}
        }
    }

    let distro_name = if !pretty_name.is_empty() {
        pretty_name
    } else if !name.is_empty() {
        name
    } else {
        "Linux".to_string()
    };

    let package = package_for_tool(tool).to_string();
    let install_command = match detect_distro_family(&id, &id_like) {
        Some(DistroFamily::Arch) => format!("sudo pacman -S {}", package),
        Some(DistroFamily::Debian) => format!("sudo apt update && sudo apt install {}", package),
        Some(DistroFamily::Fedora) => format!("sudo dnf install {}", package),
        Some(DistroFamily::OpenSuse) => format!("sudo zypper install {}", package),
        None => format!(
            "Install \"{}\" using your distribution's package manager",
            package
        ),
    };

    MissingToolInfo {
        tool: tool.to_string(),
        package,
        distro_name,
        install_command,
    }
}

pub fn format_missing_tool_error(tool: &str) -> String {
    let os_release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    let info = parse_os_release_and_command(&os_release, tool);
    let json = serde_json::to_string(&info).unwrap_or_else(|_| {
        format!(
            "{{\"tool\":\"{}\",\"package\":\"{}\",\"distroName\":\"Linux\",\"installCommand\":\"\"}}",
            tool, info.package
        )
    });
    format!("MISSING_TOOL:{}", json)
}

pub fn compress_command(
    dest_archive: &str,
    rel_items: &[String],
    format: &str,
) -> Result<(String, Vec<String>), String> {
    if rel_items.is_empty() {
        return Err("No items specified for compression".to_string());
    }
    if dest_archive.trim().is_empty() {
        return Err("Destination archive path cannot be empty".to_string());
    }

    match format.to_ascii_lowercase().as_str() {
        "zip" => {
            let mut args = Vec::with_capacity(rel_items.len() + 3);
            args.push("-r".to_string());
            args.push(dest_archive.to_string());
            args.push("--".to_string());
            args.extend(rel_items.iter().cloned());
            Ok(("zip".to_string(), args))
        }
        "tar.gz" => {
            let mut args = Vec::with_capacity(rel_items.len() + 3);
            args.push("-czvf".to_string());
            args.push(dest_archive.to_string());
            args.push("--".to_string());
            args.extend(rel_items.iter().cloned());
            Ok(("tar".to_string(), args))
        }
        _ => Err(format!("Unsupported compression format: {}", format)),
    }
}

fn strip_zip_ratio_suffix(entry: &str) -> &str {
    for marker in [" (stored ", " (deflated ", " (in="] {
        if let Some(idx) = entry.rfind(marker) {
            if entry.ends_with(')') {
                return entry[..idx].trim_end();
            }
        }
    }
    entry
}

pub fn parse_compressed_entry_line(cmd: &str, line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    match cmd {
        "tar" => Some(trimmed.to_string()),
        "zip" => {
            let lower = trimmed.to_ascii_lowercase();
            for prefix in ["adding:", "updating:"] {
                if lower.starts_with(prefix) {
                    let rest = trimmed[prefix.len()..].trim();
                    let cleaned = strip_zip_ratio_suffix(rest);
                    if !cleaned.is_empty() {
                        return Some(cleaned.to_string());
                    }
                    return None;
                }
            }
            None
        }
        _ => None,
    }
}

pub fn compute_percent(processed: usize, total: usize) -> Option<f64> {
    if total > 0 {
        Some(((processed as f64 / total as f64) * 100.0).min(100.0))
    } else {
        None
    }
}

/// Runs a CLI archive tool (`unzip`, `tar`, `unrar`, `zip`), streaming stdout
/// progress into `ExtractProgressPayload` events and converting `ErrorKind::NotFound`
/// spawn failures into `MISSING_TOOL:<json>` payloads.
#[allow(clippy::too_many_arguments)]
pub fn run_progress_command<P, L, E, F>(
    path: &str,
    cmd: &str,
    args: &[String],
    current_dir: Option<&Path>,
    total_count: usize,
    mut parse_line: P,
    mut on_line: L,
    format_failure: E,
    mut on_progress: F,
) -> Result<bool, String>
where
    P: FnMut(&str) -> Option<String>,
    L: FnMut(&str) -> bool,
    E: FnOnce(&str, &str, bool) -> String,
    F: FnMut(ExtractProgressPayload),
{
    let archive_name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();

    on_progress(ExtractProgressPayload {
        path: path.to_string(),
        archive_name: archive_name.clone(),
        current_file: String::new(),
        extracted_count: 0,
        total_count,
        percent: compute_percent(0, total_count),
        done: false,
        error: None,
    });

    let mut command = Command::new(cmd);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = current_dir {
        command.current_dir(dir);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            let err_msg = if err.kind() == std::io::ErrorKind::NotFound {
                format_missing_tool_error(cmd)
            } else {
                err.to_string()
            };
            on_progress(ExtractProgressPayload {
                path: path.to_string(),
                archive_name,
                current_file: String::new(),
                extracted_count: 0,
                total_count,
                percent: compute_percent(0, total_count),
                done: true,
                error: Some(err_msg.clone()),
            });
            return Err(err_msg);
        }
    };

    let stderr_handle = child.stderr.take().map(|mut stderr| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = stderr.read_to_string(&mut buf);
            buf
        })
    });

    let mut processed_count: usize = 0;
    let mut last_entry = String::new();
    let mut last_emit = Instant::now();
    let mut stdout_flag = false;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line_res in reader.lines() {
            let Ok(line) = line_res else {
                continue;
            };
            if on_line(&line) {
                stdout_flag = true;
            }
            if let Some(entry) = parse_line(&line) {
                processed_count += 1;
                last_entry = entry.clone();
                let is_boundary = processed_count == 1
                    || (total_count > 0 && processed_count == total_count);
                if is_boundary || last_emit.elapsed() >= Duration::from_millis(40) {
                    on_progress(ExtractProgressPayload {
                        path: path.to_string(),
                        archive_name: archive_name.clone(),
                        current_file: entry,
                        extracted_count: processed_count,
                        total_count,
                        percent: compute_percent(processed_count, total_count),
                        done: false,
                        error: None,
                    });
                    last_emit = Instant::now();
                }
            }
        }
    }

    let status = match child.wait() {
        Ok(status) => status,
        Err(err) => {
            let err_msg = err.to_string();
            on_progress(ExtractProgressPayload {
                path: path.to_string(),
                archive_name,
                current_file: last_entry,
                extracted_count: processed_count,
                total_count,
                percent: compute_percent(processed_count, total_count),
                done: true,
                error: Some(err_msg.clone()),
            });
            return Err(err_msg);
        }
    };

    let stderr_text = stderr_handle
        .and_then(|h| h.join().ok())
        .unwrap_or_default();

    if status.success() {
        on_progress(ExtractProgressPayload {
            path: path.to_string(),
            archive_name,
            current_file: last_entry,
            extracted_count: processed_count,
            total_count,
            percent: Some(100.0),
            done: true,
            error: None,
        });
        Ok(true)
    } else {
        let err_msg = format_failure(&status.to_string(), &stderr_text, stdout_flag);
        let is_password_err = err_msg.starts_with("ARCHIVE_PASSWORD_REQUIRED");
        on_progress(ExtractProgressPayload {
            path: path.to_string(),
            archive_name,
            current_file: last_entry,
            extracted_count: processed_count,
            total_count,
            percent: compute_percent(processed_count, total_count),
            done: true,
            error: Some(err_msg.clone()),
        });
        if is_password_err {
            Err(err_msg)
        } else {
            Ok(false)
        }
    }
}

fn count_items_for_compression(paths: &[String]) -> usize {
    paths
        .iter()
        .map(|p| {
            let count = walkdir::WalkDir::new(p)
                .into_iter()
                .filter_map(Result::ok)
                .count();
            count.max(1)
        })
        .sum()
}

fn format_compress_failure_message(status_display: &str, stderr_text: &str, _: bool) -> String {
    let trimmed = stderr_text.trim();
    if trimmed.is_empty() {
        format!("Compression exited with status {}", status_display)
    } else {
        trimmed.to_string()
    }
}

pub fn resolve_common_parent_and_rel_paths(
    paths: &[String],
) -> Result<(PathBuf, Vec<String>), String> {
    if paths.is_empty() {
        return Err("No items specified for compression".to_string());
    }

    let mut common_components: Option<Vec<std::path::Component<'_>>> = None;
    for p in paths {
        let path = Path::new(p);
        if path.file_name().is_none() {
            return Err(format!("Invalid path for compression: {}", p));
        }
        let parent = path
            .parent()
            .filter(|dir| !dir.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let comps: Vec<_> = parent.components().collect();
        common_components = Some(match common_components {
            None => comps,
            Some(prev) => prev
                .into_iter()
                .zip(comps)
                .take_while(|(a, b)| a == b)
                .map(|(a, _)| a)
                .collect(),
        });
    }

    let common_dir: PathBuf = match common_components {
        Some(comps) if !comps.is_empty() => comps.into_iter().collect(),
        _ => PathBuf::from("."),
    };

    let mut rel_items = Vec::with_capacity(paths.len());
    for p in paths {
        let path = Path::new(p);
        let rel = if common_dir == Path::new(".") {
            path.to_path_buf()
        } else {
            path.strip_prefix(&common_dir)
                .map(|r| r.to_path_buf())
                .map_err(|_| format!("Invalid path for compression: {}", p))?
        };
        let rel_str = rel
            .to_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("Invalid path for compression: {}", p))?;
        rel_items.push(rel_str.to_string());
    }

    Ok((common_dir, rel_items))
}

pub fn compress_files_with_progress<F>(
    paths: &[String],
    dest_archive: &str,
    format: &str,
    on_progress: F,
) -> Result<bool, String>
where
    F: FnMut(ExtractProgressPayload),
{
    let (cwd, rel_items) = resolve_common_parent_and_rel_paths(paths)?;

    let resolved_dest = if Path::new(dest_archive).is_relative() {
        std::env::current_dir()
            .map(|dir| dir.join(dest_archive).to_string_lossy().into_owned())
            .unwrap_or_else(|_| dest_archive.to_string())
    } else {
        dest_archive.to_string()
    };

    let (cmd, args) = compress_command(&resolved_dest, &rel_items, format)?;
    if let Some(parent) = Path::new(&resolved_dest)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let total_count = count_items_for_compression(paths);
    run_progress_command(
        &resolved_dest,
        &cmd,
        &args,
        Some(&cwd),
        total_count,
        |line| parse_compressed_entry_line(&cmd, line),
        |_| false,
        format_compress_failure_message,
        on_progress,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_parse_os_release_arch_ubuntu_fedora_opensuse() {
        let arch = "NAME=\"Arch Linux\"\nPRETTY_NAME=\"Arch Linux\"\nID=arch\n";
        let arch_unrar = parse_os_release_and_command(arch, "unrar");
        assert_eq!(arch_unrar.tool, "unrar");
        assert_eq!(arch_unrar.package, "unrar");
        assert_eq!(arch_unrar.distro_name, "Arch Linux");
        assert_eq!(arch_unrar.install_command, "sudo pacman -S unrar");
        let arch_zip = parse_os_release_and_command(arch, "zip");
        assert_eq!(arch_zip.install_command, "sudo pacman -S zip");

        let ubuntu = "PRETTY_NAME=\"Ubuntu 24.04 LTS\"\nID=ubuntu\nID_LIKE=debian\n";
        let ubuntu_unrar = parse_os_release_and_command(ubuntu, "unrar");
        assert_eq!(ubuntu_unrar.distro_name, "Ubuntu 24.04 LTS");
        assert_eq!(
            ubuntu_unrar.install_command,
            "sudo apt update && sudo apt install unrar"
        );
        let ubuntu_zip = parse_os_release_and_command(ubuntu, "zip");
        assert_eq!(
            ubuntu_zip.install_command,
            "sudo apt update && sudo apt install zip"
        );

        let fedora = "PRETTY_NAME=\"Fedora Linux 41 (Workstation Edition)\"\nID=fedora\n";
        let fedora_unrar = parse_os_release_and_command(fedora, "unrar");
        assert_eq!(
            fedora_unrar.distro_name,
            "Fedora Linux 41 (Workstation Edition)"
        );
        assert_eq!(fedora_unrar.install_command, "sudo dnf install unrar");
        let fedora_zip = parse_os_release_and_command(fedora, "zip");
        assert_eq!(fedora_zip.install_command, "sudo dnf install zip");

        let opensuse = "PRETTY_NAME=\"openSUSE Tumbleweed\"\nID=\"opensuse-tumbleweed\"\nID_LIKE=\"opensuse suse\"\n";
        let suse_unrar = parse_os_release_and_command(opensuse, "unrar");
        assert_eq!(suse_unrar.distro_name, "openSUSE Tumbleweed");
        assert_eq!(suse_unrar.install_command, "sudo zypper install unrar");
        let suse_zip = parse_os_release_and_command(opensuse, "zip");
        assert_eq!(suse_zip.install_command, "sudo zypper install zip");

        let unknown = "NAME=\"CustomOS\"\nID=customos\n";
        let unknown_info = parse_os_release_and_command(unknown, "unrar");
        assert_eq!(unknown_info.tool, "unrar");
        assert_eq!(unknown_info.package, "unrar");
        assert_eq!(unknown_info.distro_name, "CustomOS");
        assert!(!unknown_info.install_command.is_empty());

        let empty_info = parse_os_release_and_command("", "zip");
        assert_eq!(empty_info.tool, "zip");
        assert_eq!(empty_info.package, "zip");
        assert_eq!(empty_info.distro_name, "Linux");
        assert!(!empty_info.install_command.is_empty());
    }

    #[test]
    fn test_missing_tool_info_serializes_camel_case_with_prefix() {
        let info = MissingToolInfo {
            tool: "unrar".to_string(),
            package: "unrar".to_string(),
            distro_name: "Arch Linux".to_string(),
            install_command: "sudo pacman -S unrar".to_string(),
        };
        let json = serde_json::to_value(&info).expect("serialize MissingToolInfo");
        assert_eq!(json["tool"], "unrar");
        assert_eq!(json["package"], "unrar");
        assert_eq!(json["distroName"], "Arch Linux");
        assert_eq!(json["installCommand"], "sudo pacman -S unrar");
        assert!(json.get("distro_name").is_none());
        assert!(json.get("install_command").is_none());

        let formatted = format_missing_tool_error("unrar");
        assert!(formatted.starts_with("MISSING_TOOL:"));
        let parsed: serde_json::Value =
            serde_json::from_str(formatted.strip_prefix("MISSING_TOOL:").unwrap())
                .expect("valid JSON after MISSING_TOOL:");
        assert_eq!(parsed["tool"], "unrar");
        assert!(parsed.get("distroName").is_some());
        assert!(parsed.get("installCommand").is_some());
    }

    #[test]
    fn test_compress_command_zip_and_targz() {
        let items = vec!["a.txt".to_string(), "dir".to_string()];
        let (zip_cmd, zip_args) =
            compress_command("/tmp/out.zip", &items, "zip").expect("zip command");
        assert_eq!(zip_cmd, "zip");
        assert_eq!(zip_args, vec!["-r", "/tmp/out.zip", "--", "a.txt", "dir"]);

        let (tar_cmd, tar_args) =
            compress_command("/tmp/out.tar.gz", &items, "tar.gz").expect("tar.gz command");
        assert_eq!(tar_cmd, "tar");
        assert_eq!(
            tar_args,
            vec!["-czvf", "/tmp/out.tar.gz", "--", "a.txt", "dir"]
        );

        let dash_items = vec![
            "--checkpoint-action=exec=id".to_string(),
            "-weird.txt".to_string(),
        ];
        let (_, dash_zip_args) =
            compress_command("/tmp/out.zip", &dash_items, "zip").expect("dash zip command");
        assert_eq!(
            dash_zip_args,
            vec![
                "-r",
                "/tmp/out.zip",
                "--",
                "--checkpoint-action=exec=id",
                "-weird.txt"
            ]
        );
        let (_, dash_tar_args) =
            compress_command("/tmp/out.tar.gz", &dash_items, "tar.gz").expect("dash tar command");
        assert_eq!(
            dash_tar_args,
            vec![
                "-czvf",
                "/tmp/out.tar.gz",
                "--",
                "--checkpoint-action=exec=id",
                "-weird.txt"
            ]
        );

        assert!(compress_command("/tmp/out.rar", &items, "rar").is_err());
        assert!(compress_command("/tmp/out.7z", &items, "7z").is_err());
        assert!(compress_command("/tmp/out.zip", &[], "zip").is_err());
    }

    #[test]
    fn test_resolve_common_parent_and_rel_paths() {
        let same_dir = vec!["/a/b/x.txt".to_string(), "/a/b/y.txt".to_string()];
        let (cwd, rel) =
            resolve_common_parent_and_rel_paths(&same_dir).expect("same dir selection");
        assert_eq!(cwd, PathBuf::from("/a/b"));
        assert_eq!(rel, vec!["x.txt", "y.txt"]);

        let cross_dir = vec!["/a/b/x.txt".to_string(), "/a/c/y.txt".to_string()];
        let (cwd2, rel2) =
            resolve_common_parent_and_rel_paths(&cross_dir).expect("cross dir selection");
        assert_eq!(cwd2, PathBuf::from("/a"));
        assert_eq!(rel2, vec!["b/x.txt", "c/y.txt"]);

        let nested = vec!["/a/b/x.txt".to_string(), "/a/b/sub/y.txt".to_string()];
        let (cwd3, rel3) =
            resolve_common_parent_and_rel_paths(&nested).expect("nested dir selection");
        assert_eq!(cwd3, PathBuf::from("/a/b"));
        assert_eq!(rel3, vec!["x.txt", "sub/y.txt"]);

        let root_common = vec!["/a/x.txt".to_string(), "/b/y.txt".to_string()];
        let (cwd4, rel4) =
            resolve_common_parent_and_rel_paths(&root_common).expect("root common ancestor");
        assert_eq!(cwd4, PathBuf::from("/"));
        assert_eq!(rel4, vec!["a/x.txt", "b/y.txt"]);

        assert!(resolve_common_parent_and_rel_paths(&[]).is_err());
    }

    #[test]
    fn test_run_progress_command_password_error_returns_err() {
        let mut events = Vec::new();
        let res = run_progress_command(
            "/tmp/secret.rar",
            "false",
            &[],
            None,
            1,
            |_| None,
            |_| false,
            |_, _, _| "ARCHIVE_PASSWORD_REQUIRED: This archive is password-protected.".to_string(),
            |ev| events.push(ev),
        );
        let err_msg = res.expect_err("password error should return Err");
        assert!(
            err_msg.starts_with("ARCHIVE_PASSWORD_REQUIRED"),
            "expected ARCHIVE_PASSWORD_REQUIRED prefix, got: {}",
            err_msg
        );
        let last = events.last().expect("done event on password error");
        assert!(last.done);
        assert_eq!(last.error.as_deref(), Some(err_msg.as_str()));
    }

    #[test]
    fn test_parse_compressed_entry_line_zip_and_tar() {
        assert_eq!(
            parse_compressed_entry_line("zip", "  adding: alpha.txt (stored 0%)"),
            Some("alpha.txt".to_string())
        );
        assert_eq!(
            parse_compressed_entry_line("zip", "  adding: dir/notes (v1).txt (deflated 42%)"),
            Some("dir/notes (v1).txt".to_string())
        );
        assert_eq!(
            parse_compressed_entry_line("zip", "  updating: beta.txt (stored 0%)"),
            Some("beta.txt".to_string())
        );
        assert_eq!(
            parse_compressed_entry_line("zip", "zip warning: something"),
            None
        );
        assert_eq!(
            parse_compressed_entry_line("tar", "alpha.txt\n"),
            Some("alpha.txt".to_string())
        );
        assert_eq!(parse_compressed_entry_line("tar", "   "), None);
    }

    #[test]
    fn test_compress_files_with_progress_tar_gz_creates_archive() {
        let dir = tempdir().expect("create tempdir");
        let file_a = dir.path().join("alpha.txt");
        let file_b = dir.path().join("beta.txt");
        std::fs::write(&file_a, "alpha content").expect("write alpha");
        std::fs::write(&file_b, "beta content").expect("write beta");

        let dest = dir.path().join("bundle.tar.gz");
        let paths = vec![
            file_a.to_str().unwrap().to_string(),
            file_b.to_str().unwrap().to_string(),
        ];

        let mut events = Vec::new();
        let ok = compress_files_with_progress(&paths, dest.to_str().unwrap(), "tar.gz", |ev| {
            events.push(ev);
        })
        .expect("compress tar.gz");

        assert!(ok);
        assert!(dest.exists());
        let last = events.last().expect("final progress event");
        assert!(last.done);
        assert_eq!(last.error, None);
        assert_eq!(last.percent, Some(100.0));
        assert_eq!(last.total_count, 2);
        assert_eq!(last.extracted_count, 2);

        // Verify tar contents use relative filenames (not full paths)
        let list_out = std::process::Command::new("tar")
            .arg("-tzf")
            .arg(&dest)
            .output()
            .expect("list tar.gz");
        assert!(list_out.status.success());
        let listing = String::from_utf8_lossy(&list_out.stdout);
        let lines: Vec<&str> = listing.lines().collect();
        assert_eq!(lines, vec!["alpha.txt", "beta.txt"]);
    }

    #[test]
    fn test_run_progress_command_not_found_emits_missing_tool() {
        let mut events = Vec::new();
        let res = run_progress_command(
            "/tmp/out.zip",
            "__nonexistent_compress_tool_xyz__",
            &[],
            None,
            2,
            |_| None,
            |_| false,
            format_compress_failure_message,
            |ev| events.push(ev),
        );
        let err_msg = res.expect_err("nonexistent binary should error");
        assert!(
            err_msg.starts_with("MISSING_TOOL:"),
            "expected MISSING_TOOL: prefix, got: {}",
            err_msg
        );
        let last = events.last().expect("done event on missing tool");
        assert!(last.done);
        assert_eq!(last.error.as_deref(), Some(err_msg.as_str()));
    }
}
