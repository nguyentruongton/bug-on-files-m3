use crate::fs_ops::{self, FileEntry};

#[tauri::command(rename_all = "camelCase")]
pub fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    fs_ops::list_dir(&path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_parent(path: String) -> Result<String, String> {
    Ok(fs_ops::parent_of(&path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_home() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Failed to resolve home directory".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn copy_file(source: String, dest: String) -> Result<bool, String> {
    fs_ops::copy_path(&source, &dest).map(|_| true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn move_file(source: String, dest: String) -> Result<bool, String> {
    fs_ops::move_path(&source, &dest).map(|_| true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn trash_file(path: String) -> Result<bool, String> {
    trash::delete(&path).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn rename_file(old_path: String, new_path: String) -> Result<bool, String> {
    fs_ops::rename_path(&old_path, &new_path).map(|_| true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_directory(path: String) -> Result<bool, String> {
    fs_ops::make_dir(&path).map(|_| true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn exists(path: String) -> Result<bool, String> {
    Ok(fs_ops::exists(&path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_file(path: String) -> Result<Option<String>, String> {
    Ok(fs_ops::read_file_text(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commands_basic() {
        assert!(get_home().is_ok());
        assert_eq!(get_parent("/a/b".into()).unwrap(), "/a");

        let temp = tempfile::tempdir().unwrap();
        let f1 = temp.path().join("f1.txt");
        let f2 = temp.path().join("f2.txt");
        let f3 = temp.path().join("f3.txt");
        let new_dir = temp.path().join("sub_dir");

        std::fs::write(&f1, "content").unwrap();
        assert_eq!(exists(f1.to_str().unwrap().into()).unwrap(), true);
        assert_eq!(read_file(f1.to_str().unwrap().into()).unwrap(), Some("content".into()));

        assert_eq!(copy_file(f1.to_str().unwrap().into(), f2.to_str().unwrap().into()).unwrap(), true);
        assert_eq!(exists(f2.to_str().unwrap().into()).unwrap(), true);

        assert_eq!(rename_file(f2.to_str().unwrap().into(), f3.to_str().unwrap().into()).unwrap(), true);
        assert_eq!(exists(f2.to_str().unwrap().into()).unwrap(), false);
        assert_eq!(exists(f3.to_str().unwrap().into()).unwrap(), true);

        assert_eq!(create_directory(new_dir.to_str().unwrap().into()).unwrap(), true);
        assert_eq!(exists(new_dir.to_str().unwrap().into()).unwrap(), true);

        let dest_moved = new_dir.join("f3.txt");
        assert_eq!(move_file(f3.to_str().unwrap().into(), dest_moved.to_str().unwrap().into()).unwrap(), true);
        assert_eq!(exists(dest_moved.to_str().unwrap().into()).unwrap(), true);

        let list = list_dir(new_dir.to_str().unwrap().into()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "f3.txt");
    }

    #[test]
    fn test_trash_file_if_available() {
        let temp = tempfile::tempdir().unwrap();
        let f = temp.path().join("trash_candidate.txt");
        std::fs::write(&f, "trash me").unwrap();
        // trash might fail in environments without trash support, but if it runs,
        // it returns Ok(true) and file no longer exists at original location.
        if let Ok(res) = trash_file(f.to_str().unwrap().into()) {
            assert!(res);
            assert!(!f.exists());
        }
    }
}
