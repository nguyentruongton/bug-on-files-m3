use crate::fs_ops::{self, FileEntry};
use crate::places::{self, PlaceItem, PlaceKey};
use crate::text_preview::{self, TextPreview};

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

#[tauri::command(rename_all = "camelCase")]
pub fn get_places() -> Result<Vec<PlaceItem>, String> {
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Failed to resolve home directory".to_string())?;

    let places = places::resolve_places(&home, |key| {
        match key {
            PlaceKey::Home => dirs::home_dir(),
            PlaceKey::Desktop => dirs::desktop_dir(),
            PlaceKey::Documents => dirs::document_dir(),
            PlaceKey::Downloads => dirs::download_dir(),
            PlaceKey::Music => dirs::audio_dir(),
            PlaceKey::Pictures => dirs::picture_dir(),
            PlaceKey::Videos => dirs::video_dir(),
        }
        .map(|p| p.to_string_lossy().into_owned())
    });

    Ok(places)
}

#[tauri::command(rename_all = "camelCase")]
pub fn read_text_preview(path: String) -> TextPreview {
    text_preview::read_text_preview(&path, text_preview::TEXT_PREVIEW_MAX_BYTES)
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

    #[test]
    fn test_get_places_and_read_text_preview_commands() {
        let places = get_places().unwrap();
        assert_eq!(places.len(), 7);
        assert_eq!(places[0].name, "Home");
        assert_eq!(places[1].name, "Desktop");
        assert_eq!(places[2].name, "Documents");
        assert_eq!(places[3].name, "Downloads");
        assert_eq!(places[4].name, "Music");
        assert_eq!(places[5].name, "Pictures");
        assert_eq!(places[6].name, "Videos");

        let temp = tempfile::tempdir().unwrap();
        let f = temp.path().join("preview.txt");
        std::fs::write(&f, "hello preview").unwrap();

        let preview = read_text_preview(f.to_str().unwrap().into());
        assert_eq!(
            preview,
            TextPreview::Text {
                content: "hello preview".to_string()
            }
        );

        let err_preview = read_text_preview("/nonexistent/file/path".into());
        assert_eq!(err_preview, TextPreview::Error);
    }
}
