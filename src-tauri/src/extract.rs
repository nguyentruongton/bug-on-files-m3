use std::path::Path;

pub fn extract_command(file: &str) -> Option<(String, Vec<String>)> {
    let path = Path::new(file);
    let dir = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_string_lossy().into_owned(),
        _ => ".".to_string(),
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())?;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
