use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub mtime_ms: u64,
}

pub fn list_dir(path: &str) -> Result<Vec<FileEntry>, String> {
    let target_path = if path.trim().is_empty() {
        dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?
    } else {
        std::path::PathBuf::from(path)
    };

    let read_dir = std::fs::read_dir(&target_path)
        .map_err(|e| format!("Failed to read directory '{}': {}", target_path.display(), e))?;

    let mut result = Vec::new();
    for entry_res in read_dir {
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let full_path = entry.path();
        // Follow symlinks like fs.stat; skip entries where metadata fails (e.g. broken symlinks)
        let metadata = match std::fs::metadata(&full_path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().into_owned();
        let path_str = full_path.to_string_lossy().into_owned();
        let is_directory = metadata.is_dir();
        let size = metadata.len();
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        result.push(FileEntry {
            name,
            path: path_str,
            is_directory,
            size,
            mtime_ms,
        });
    }

    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

pub fn copy_path(source: &str, dest: &str) -> Result<(), String> {
    let src_path = std::path::Path::new(source);
    let dest_path = std::path::Path::new(dest);

    copy_path_recursive(src_path, dest_path)
}

fn copy_path_recursive(source: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let src_meta = std::fs::symlink_metadata(source)
        .map_err(|e| format!("Failed to read metadata for '{}': {}", source.display(), e))?;

    if src_meta.is_dir() {
        if dest.symlink_metadata().is_ok() {
            if !dest.is_dir() {
                return Err(format!(
                    "Cannot copy directory '{}' to non-directory '{}'",
                    source.display(),
                    dest.display()
                ));
            }
        } else {
            std::fs::create_dir_all(dest)
                .map_err(|e| format!("Failed to create directory '{}': {}", dest.display(), e))?;
        }

        let entries = std::fs::read_dir(source)
            .map_err(|e| format!("Failed to read directory '{}': {}", source.display(), e))?;

        for entry_res in entries {
            let entry = entry_res.map_err(|e| format!("Error reading directory entry: {}", e))?;
            let child_src = entry.path();
            let child_dest = dest.join(entry.file_name());
            copy_path_recursive(&child_src, &child_dest)?;
        }
        Ok(())
    } else if src_meta.file_type().is_symlink() {
        // Force: false semantics - existing destination files or symlinks are kept
        if dest.symlink_metadata().is_ok() {
            return Ok(());
        }
        if let Some(parent) = dest.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
            }
        }
        let target = std::fs::read_link(source)
            .map_err(|e| format!("Failed to read symlink '{}': {}", source.display(), e))?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, dest).map_err(|e| {
            format!(
                "Failed to recreate symlink at '{}': {}",
                dest.display(),
                e
            )
        })?;
        #[cfg(windows)]
        {
            if target.is_dir() {
                std::os::windows::fs::symlink_dir(&target, dest).map_err(|e| {
                    format!("Failed to recreate symlink dir at '{}': {}", dest.display(), e)
                })?;
            } else {
                std::os::windows::fs::symlink_file(&target, dest).map_err(|e| {
                    format!("Failed to recreate symlink file at '{}': {}", dest.display(), e)
                })?;
            }
        }
        #[cfg(not(any(unix, windows)))]
        {
            return Err(format!(
                "Symlink recreation unsupported on this platform: {}",
                dest.display()
            ));
        }
        Ok(())
    } else {
        // Force: false semantics - existing destination files are kept
        if dest.symlink_metadata().is_ok() {
            return Ok(());
        }
        if let Some(parent) = dest.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory '{}': {}", parent.display(), e))?;
            }
        }
        std::fs::copy(source, dest).map_err(|e| {
            format!(
                "Failed to copy file from '{}' to '{}': {}",
                source.display(),
                dest.display(),
                e
            )
        })?;
        Ok(())
    }
}

pub fn move_path(source: &str, dest: &str) -> Result<(), String> {
    let src_path = std::path::Path::new(source);
    let dest_path = std::path::Path::new(dest);

    match std::fs::rename(src_path, dest_path) {
        Ok(()) => Ok(()),
        Err(err) => {
            let is_cross_device = err.kind() == std::io::ErrorKind::CrossesDevices
                || err.raw_os_error() == Some(18)
                || err.to_string().to_lowercase().contains("cross-device");

            if is_cross_device {
                let meta = src_path
                    .symlink_metadata()
                    .map_err(|e| format!("Failed to read metadata for '{}': {}", source, e))?;

                if meta.file_type().is_symlink() {
                    let target = std::fs::read_link(src_path)
                        .map_err(|e| format!("Failed to read symlink '{}': {}", source, e))?;
                    #[cfg(unix)]
                    std::os::unix::fs::symlink(&target, dest_path)
                        .map_err(|e| format!("Failed to recreate symlink at '{}': {}", dest, e))?;
                    #[cfg(windows)]
                    {
                        if target.is_dir() {
                            std::os::windows::fs::symlink_dir(&target, dest_path).map_err(|e| {
                                format!("Failed to recreate symlink dir at '{}': {}", dest, e)
                            })?;
                        } else {
                            std::os::windows::fs::symlink_file(&target, dest_path).map_err(|e| {
                                format!("Failed to recreate symlink file at '{}': {}", dest, e)
                            })?;
                        }
                    }
                    std::fs::remove_file(src_path)
                        .map_err(|e| format!("Failed to remove source symlink '{}': {}", source, e))?;
                } else if meta.is_dir() {
                    copy_path(source, dest)?;
                    std::fs::remove_dir_all(src_path).map_err(|e| {
                        format!("Failed to remove source directory '{}': {}", source, e)
                    })?;
                } else {
                    copy_path(source, dest)?;
                    std::fs::remove_file(src_path)
                        .map_err(|e| format!("Failed to remove source file '{}': {}", source, e))?;
                }
                Ok(())
            } else {
                Err(format!("Failed to move '{}' to '{}': {}", source, dest, err))
            }
        }
    }
}

pub fn rename_path(old_path: &str, new_path: &str) -> Result<(), String> {
    std::fs::rename(old_path, new_path)
        .map_err(|e| format!("Failed to rename '{}' to '{}': {}", old_path, new_path, e))
}

pub fn make_dir(path: &str) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}

pub fn exists(path: &str) -> bool {
    std::path::Path::new(path).symlink_metadata().is_ok()
}

pub fn parent_of(path: &str) -> String {
    let p = std::path::Path::new(path);
    match p.parent() {
        Some(parent) => {
            let s = parent.to_string_lossy();
            if s.is_empty() {
                ".".to_string()
            } else {
                s.into_owned()
            }
        }
        None => {
            if path.starts_with('/') {
                "/".to_string()
            } else {
                ".".to_string()
            }
        }
    }
}

pub fn read_file_text(path: &str) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_dir_skips_broken_symlink() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();
        let target = root.join("valid_target.txt");
        std::fs::write(&target, "valid content").unwrap();

        let valid_symlink = root.join("valid_symlink.txt");
        std::os::unix::fs::symlink(&target, &valid_symlink).unwrap();

        let broken_symlink = root.join("broken_symlink.txt");
        std::os::unix::fs::symlink(root.join("nonexistent_file.txt"), &broken_symlink).unwrap();

        let entries = list_dir(root.to_str().unwrap()).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert!(names.contains(&"valid_target.txt".to_string()));
        assert!(names.contains(&"valid_symlink.txt".to_string()));
        assert!(!names.contains(&"broken_symlink.txt".to_string()));
    }

    #[test]
    fn list_dir_handles_spaces_and_unicode_names() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();
        std::fs::write(root.join("spaced file name.txt"), "spaced").unwrap();
        std::fs::write(root.join("🚀 rocket.dat"), "unicode").unwrap();
        std::fs::write(root.join("日本語ファイル.md"), "japanese").unwrap();

        let entries = list_dir(root.to_str().unwrap()).unwrap();
        let names: Vec<String> = entries.into_iter().map(|e| e.name).collect();
        assert!(names.contains(&"spaced file name.txt".to_string()));
        assert!(names.contains(&"🚀 rocket.dat".to_string()));
        assert!(names.contains(&"日本語ファイル.md".to_string()));
    }

    #[test]
    fn list_dir_empty_path_uses_home() {
        let home = dirs::home_dir().expect("must have a home directory");
        let entries = list_dir("").expect("empty path should list home dir");
        assert!(!entries.is_empty());
        let home_str = home.to_string_lossy();
        assert!(entries.iter().all(|e| e.path.starts_with(home_str.as_ref())));
    }

    #[test]
    fn list_dir_handles_non_utf8_and_hidden() {
        use std::os::unix::ffi::OsStringExt;

        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();
        std::fs::write(root.join(".hidden"), "hidden content").unwrap();

        let invalid_bytes = vec![b'b', b'a', b'd', 0xff, b'.', b't', b'x', b't'];
        let non_utf8_os_str = std::ffi::OsString::from_vec(invalid_bytes);
        let non_utf8_path = root.join(&non_utf8_os_str);
        std::fs::write(&non_utf8_path, "bytes").unwrap();

        let entries = list_dir(root.to_str().unwrap()).unwrap();
        let names: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert!(names.contains(&".hidden".to_string()));
        let expected_lossy = non_utf8_os_str.to_string_lossy().into_owned();
        assert!(names.contains(&expected_lossy));
    }

    #[test]
    fn copy_path_recurses_directories() {
        let temp_src = tempfile::tempdir().unwrap();
        let src_root = temp_src.path();
        let temp_dest = tempfile::tempdir().unwrap();
        let dest_root = temp_dest.path().join("copied_dir");

        std::fs::write(src_root.join("root_file.txt"), "hello root").unwrap();
        let sub = src_root.join("nested_folder");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("nested_file.txt"), "hello nested").unwrap();

        copy_path(src_root.to_str().unwrap(), dest_root.to_str().unwrap()).unwrap();

        assert_eq!(
            std::fs::read_to_string(dest_root.join("root_file.txt")).unwrap(),
            "hello root"
        );
        assert_eq!(
            std::fs::read_to_string(dest_root.join("nested_folder").join("nested_file.txt")).unwrap(),
            "hello nested"
        );
    }

    #[test]
    fn copy_path_keeps_existing_destination_files() {
        let temp_src = tempfile::tempdir().unwrap();
        let src_root = temp_src.path();
        let temp_dest = tempfile::tempdir().unwrap();
        let dest_root = temp_dest.path().join("target_dir");

        std::fs::create_dir_all(dest_root.join("sub")).unwrap();
        std::fs::write(dest_root.join("file1.txt"), "existing original").unwrap();

        std::fs::write(src_root.join("file1.txt"), "new content from source").unwrap();
        std::fs::write(src_root.join("file2.txt"), "new file2").unwrap();
        let src_sub = src_root.join("sub");
        std::fs::create_dir_all(&src_sub).unwrap();
        std::fs::write(src_sub.join("sub_file.txt"), "sub content").unwrap();

        copy_path(src_root.to_str().unwrap(), dest_root.to_str().unwrap()).unwrap();

        assert_eq!(
            std::fs::read_to_string(dest_root.join("file1.txt")).unwrap(),
            "existing original"
        );
        assert_eq!(
            std::fs::read_to_string(dest_root.join("file2.txt")).unwrap(),
            "new file2"
        );
        assert_eq!(
            std::fs::read_to_string(dest_root.join("sub").join("sub_file.txt")).unwrap(),
            "sub content"
        );
    }

    #[test]
    #[cfg(unix)]
    fn copy_dir_preserves_nested_broken_symlink() {
        let temp_src = tempfile::tempdir().unwrap();
        let src_dir = temp_src.path().join("source_dir");
        std::fs::create_dir_all(&src_dir).unwrap();

        let hello_file = src_dir.join("hello.txt");
        std::fs::write(&hello_file, "hello world").unwrap();

        let dangling_symlink = src_dir.join("dangling");
        let nonexistent_target = std::path::Path::new("/nonexistent/target");
        std::os::unix::fs::symlink(nonexistent_target, &dangling_symlink).unwrap();

        let temp_dest = tempfile::tempdir().unwrap();
        let dest_dir = temp_dest.path().join("dest_dir");

        copy_path(src_dir.to_str().unwrap(), dest_dir.to_str().unwrap()).unwrap();

        let copied_hello = dest_dir.join("hello.txt");
        assert_eq!(std::fs::read_to_string(&copied_hello).unwrap(), "hello world");

        let copied_dangling = dest_dir.join("dangling");
        let meta = copied_dangling
            .symlink_metadata()
            .expect("dest/dangling must exist");
        assert!(meta.file_type().is_symlink());
        assert_eq!(
            std::fs::read_link(&copied_dangling).unwrap(),
            nonexistent_target
        );
    }

    #[test]
    #[cfg(unix)]
    fn copy_path_keeps_existing_destination_broken_symlink() {
        let temp = tempfile::tempdir().unwrap();
        let src_file = temp.path().join("src.txt");
        std::fs::write(&src_file, "new data").unwrap();

        let dest_symlink = temp.path().join("dest_symlink.txt");
        let non_target = temp.path().join("missing.txt");
        std::os::unix::fs::symlink(&non_target, &dest_symlink).unwrap();

        copy_path(src_file.to_str().unwrap(), dest_symlink.to_str().unwrap()).unwrap();

        assert!(dest_symlink.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_link(&dest_symlink).unwrap(), non_target);
    }

    #[test]
    fn move_path_renames_file() {
        let temp = tempfile::tempdir().unwrap();
        let src = temp.path().join("before.txt");
        let dest = temp.path().join("after.txt");

        std::fs::write(&src, "move payload").unwrap();
        move_path(src.to_str().unwrap(), dest.to_str().unwrap()).unwrap();

        assert!(!src.exists());
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "move payload");
    }

    #[test]
    fn move_path_moves_broken_symlink() {
        let temp = tempfile::tempdir().unwrap();
        let broken_src = temp.path().join("broken_symlink.txt");
        let broken_dest = temp.path().join("moved_broken_symlink.txt");

        std::os::unix::fs::symlink(temp.path().join("does_not_exist.txt"), &broken_src).unwrap();
        assert!(broken_src.symlink_metadata().is_ok());
        assert!(!broken_src.exists());

        move_path(
            broken_src.to_str().unwrap(),
            broken_dest.to_str().unwrap(),
        )
        .unwrap();

        assert!(!broken_src.symlink_metadata().is_ok());
        assert!(broken_dest.symlink_metadata().is_ok());
        assert_eq!(
            std::fs::read_link(&broken_dest).unwrap(),
            temp.path().join("does_not_exist.txt")
        );
    }

    #[test]
    fn make_dir_is_recursive() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("deeply").join("nested").join("directory");

        assert!(!target.exists());
        make_dir(target.to_str().unwrap()).unwrap();
        assert!(target.is_dir());

        assert!(make_dir(target.to_str().unwrap()).is_ok());
    }

    #[test]
    fn parent_of_root_is_root() {
        assert_eq!(parent_of("/"), "/");
        assert_eq!(parent_of("/usr"), "/");
        assert_eq!(parent_of("/usr/bin"), "/usr");
        assert_eq!(parent_of("a"), ".");
        assert_eq!(parent_of(""), ".");
        assert_eq!(parent_of("/foo/bar/"), "/foo");
    }

    #[test]
    fn exists_checks_paths() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("present.txt");
        std::fs::write(&file, "yes").unwrap();

        assert!(exists(file.to_str().unwrap()));
        assert!(!exists(temp.path().join("missing.txt").to_str().unwrap()));

        let broken_symlink = temp.path().join("broken.txt");
        std::os::unix::fs::symlink(temp.path().join("nonexistent.txt"), &broken_symlink).unwrap();
        assert!(exists(broken_symlink.to_str().unwrap()));
    }

    #[test]
    fn read_file_text_reads_utf8_or_none() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("utf8.txt");
        std::fs::write(&file, "hello world").unwrap();

        assert_eq!(read_file_text(file.to_str().unwrap()), Some("hello world".to_string()));
        assert_eq!(read_file_text(temp.path().join("missing.txt").to_str().unwrap()), None);

        let bin_file = temp.path().join("invalid.bin");
        std::fs::write(&bin_file, [0xff, 0xfe, 0xfd]).unwrap();
        assert_eq!(read_file_text(bin_file.to_str().unwrap()), None);
    }

    #[test]
    fn rename_path_renames_entry() {
        let temp = tempfile::tempdir().unwrap();
        let old_f = temp.path().join("old.txt");
        let new_f = temp.path().join("new.txt");
        std::fs::write(&old_f, "rename me").unwrap();

        rename_path(old_f.to_str().unwrap(), new_f.to_str().unwrap()).unwrap();
        assert!(!old_f.exists());
        assert_eq!(std::fs::read_to_string(&new_f).unwrap(), "rename me");
    }

    #[test]
    fn rename_path_renames_broken_symlink() {
        let temp = tempfile::tempdir().unwrap();
        let broken_src = temp.path().join("broken_orig.txt");
        let broken_dest = temp.path().join("broken_renamed.txt");

        std::os::unix::fs::symlink(temp.path().join("target_missing.txt"), &broken_src).unwrap();
        rename_path(broken_src.to_str().unwrap(), broken_dest.to_str().unwrap()).unwrap();
        assert!(!broken_src.symlink_metadata().is_ok());
        assert!(broken_dest.symlink_metadata().is_ok());
    }
}
