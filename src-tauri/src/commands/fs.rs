use crate::fs_ops::{self, FileEntry};
use crate::places::{self, PlaceItem, PlaceKey};
use crate::text_preview::{self, TextPreview};
use crate::watcher::Watchers;

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
pub fn list_trash() -> Result<Vec<FileEntry>, String> {
    fs_ops::list_trash()
}

#[tauri::command(rename_all = "camelCase")]
pub fn restore_trash_items(ids: Vec<String>) -> Result<bool, String> {
    fs_ops::restore_trash_items(&ids)
}

#[tauri::command(rename_all = "camelCase")]
pub fn purge_trash_items(ids: Vec<String>) -> Result<bool, String> {
    fs_ops::purge_trash_items(&ids)
}

#[tauri::command(rename_all = "camelCase")]
pub fn empty_trash() -> Result<bool, String> {
    fs_ops::empty_trash()
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

#[tauri::command(rename_all = "camelCase")]
pub fn watch_start(state: tauri::State<'_, Watchers>, dir: String) -> u32 {
    state.start(&dir)
}

#[tauri::command(rename_all = "camelCase")]
pub fn watch_stop(state: tauri::State<'_, Watchers>, id: u32) {
    state.stop(id);
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
        assert!(exists(f1.to_str().unwrap().into()).unwrap());
        assert_eq!(read_file(f1.to_str().unwrap().into()).unwrap(), Some("content".into()));

        assert!(copy_file(f1.to_str().unwrap().into(), f2.to_str().unwrap().into()).unwrap());
        assert!(exists(f2.to_str().unwrap().into()).unwrap());

        assert!(rename_file(f2.to_str().unwrap().into(), f3.to_str().unwrap().into()).unwrap());
        assert!(!exists(f2.to_str().unwrap().into()).unwrap());
        assert!(exists(f3.to_str().unwrap().into()).unwrap());

        assert!(create_directory(new_dir.to_str().unwrap().into()).unwrap());
        assert!(exists(new_dir.to_str().unwrap().into()).unwrap());

        let dest_moved = new_dir.join("f3.txt");
        assert!(move_file(f3.to_str().unwrap().into(), dest_moved.to_str().unwrap().into()).unwrap());
        assert!(exists(dest_moved.to_str().unwrap().into()).unwrap());

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

    #[test]
    fn test_trash_lifecycle_list_restore_with_collision_and_missing_parent_and_purge() {
        let temp = tempfile::tempdir().unwrap();
        let nested_parent = temp.path().join("deleted_parent");
        let missing_parent = temp.path().join("removed_dir").join("deep");
        std::fs::create_dir_all(&nested_parent).unwrap();
        std::fs::create_dir_all(&missing_parent).unwrap();

        let file_a = nested_parent.join("note.txt");
        std::fs::write(&file_a, "first version").unwrap();

        // If system trash is unavailable in this environment, skip gracefully
        if trash_file(file_a.to_str().unwrap().into()).is_err() {
            return;
        }
        assert!(!file_a.exists());

        // Create a new file at the same path to force a collision on restore,
        // trash a second file to test purge_trash_items, and trash a third file whose parent gets removed
        std::fs::write(&file_a, "blocking version").unwrap();
        let file_b = nested_parent.join("purge_me.txt");
        std::fs::write(&file_b, "to be purged").unwrap();
        trash_file(file_b.to_str().unwrap().into()).unwrap();

        let file_c = missing_parent.join("recreate.txt");
        std::fs::write(&file_c, "recreate parent").unwrap();
        trash_file(file_c.to_str().unwrap().into()).unwrap();
        std::fs::remove_dir_all(temp.path().join("removed_dir")).unwrap();
        assert!(!missing_parent.exists());

        let all_trashed = list_trash().unwrap();
        let nested_parent_str = nested_parent.to_string_lossy().into_owned();
        let missing_parent_str = missing_parent.to_string_lossy().into_owned();
        let entry_a = all_trashed
            .iter()
            .find(|e| e.name == "note.txt" && e.original_parent.as_deref() == Some(nested_parent_str.as_str()))
            .expect("trashed note.txt must appear in list_trash");
        let entry_b = all_trashed
            .iter()
            .find(|e| e.name == "purge_me.txt" && e.original_parent.as_deref() == Some(nested_parent_str.as_str()))
            .expect("trashed purge_me.txt must appear in list_trash");
        let entry_c = all_trashed
            .iter()
            .find(|e| e.name == "recreate.txt" && e.original_parent.as_deref() == Some(missing_parent_str.as_str()))
            .expect("trashed recreate.txt must appear in list_trash");

        let id_a = entry_a.trash_id.clone().expect("must have trash_id");
        let id_b = entry_b.trash_id.clone().expect("must have trash_id");
        let id_c = entry_c.trash_id.clone().expect("must have trash_id");

        // Restore entry_a while "note.txt" exists -> must create "note (restored).txt"
        assert!(restore_trash_items(vec![id_a]).unwrap());
        let restored_collision = nested_parent.join("note (restored).txt");
        assert_eq!(std::fs::read_to_string(&restored_collision).unwrap(), "first version");
        assert_eq!(std::fs::read_to_string(&file_a).unwrap(), "blocking version");

        // Restore entry_c whose parent directory was deleted -> must recreate parent and restore file
        assert!(restore_trash_items(vec![id_c]).unwrap());
        assert_eq!(std::fs::read_to_string(&file_c).unwrap(), "recreate parent");

        // Purge entry_b -> must remove it from trash without restoring
        assert!(purge_trash_items(vec![id_b.clone()]).unwrap());
        assert!(!nested_parent.join("purge_me.txt").exists());
        let after_purge = list_trash().unwrap();
        assert!(!after_purge.iter().any(|e| e.trash_id.as_deref() == Some(id_b.as_str())));
    }
}
