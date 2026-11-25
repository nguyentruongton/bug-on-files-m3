use crate::fs_ops::{self, FileEntry};
use crate::places::{self, PlaceItem, PlaceKey};
use crate::text_preview::{self, TextPreview};
use crate::watcher::Watchers;

#[tauri::command(rename_all = "camelCase")]
pub async fn list_dir(path: String) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::list_dir(&path))
        .await
        .map_err(|e| e.to_string())?
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
pub async fn copy_file(source: String, dest: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::copy_path(&source, &dest).map(|_| true))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn move_file(source: String, dest: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::move_path(&source, &dest).map(|_| true))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn trash_file(path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        trash::delete(&path).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_trash() -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(fs_ops::list_trash)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn restore_trash_items(ids: Vec<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::restore_trash_items(&ids))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn purge_trash_items(ids: Vec<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::purge_trash_items(&ids))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn empty_trash() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(fs_ops::empty_trash)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn rename_file(old_path: String, new_path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fs_ops::rename_path(&old_path, &new_path).map(|_| true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn create_directory(path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::make_dir(&path).map(|_| true))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn exists(path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::exists(&path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_file(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || fs_ops::read_file_text(&path))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_places() -> Result<Vec<PlaceItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn read_text_preview(path: String) -> TextPreview {
    tauri::async_runtime::spawn_blocking(move || {
        text_preview::read_text_preview(&path, text_preview::TEXT_PREVIEW_MAX_BYTES)
    })
    .await
    .unwrap_or(TextPreview::Error)
}

pub async fn watch_start_with_state(watchers: Watchers, dir: String) -> u32 {
    tauri::async_runtime::spawn_blocking(move || watchers.start(&dir))
        .await
        .unwrap_or(0)
}

pub async fn watch_stop_with_state(watchers: Watchers, id: u32) {
    let _ = tauri::async_runtime::spawn_blocking(move || watchers.stop(id)).await;
}

#[tauri::command(rename_all = "camelCase")]
pub async fn watch_start(state: tauri::State<'_, Watchers>, dir: String) -> Result<u32, String> {
    Ok(watch_start_with_state(state.inner().clone(), dir).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn watch_stop(state: tauri::State<'_, Watchers>, id: u32) -> Result<(), String> {
    watch_stop_with_state(state.inner().clone(), id).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn test_commands_basic() {
        tauri::async_runtime::block_on(async {
            assert!(get_home().is_ok());
            assert_eq!(get_parent("/a/b".into()).unwrap(), "/a");

            let temp = tempfile::tempdir().unwrap();
            let f1 = temp.path().join("f1.txt");
            let f2 = temp.path().join("f2.txt");
            let f3 = temp.path().join("f3.txt");
            let new_dir = temp.path().join("sub_dir");

            std::fs::write(&f1, "content").unwrap();
            assert!(exists(f1.to_str().unwrap().into()).await.unwrap());
            assert_eq!(
                read_file(f1.to_str().unwrap().into()).await.unwrap(),
                Some("content".into())
            );

            assert!(
                copy_file(f1.to_str().unwrap().into(), f2.to_str().unwrap().into())
                    .await
                    .unwrap()
            );
            assert!(exists(f2.to_str().unwrap().into()).await.unwrap());

            assert!(
                rename_file(f2.to_str().unwrap().into(), f3.to_str().unwrap().into())
                    .await
                    .unwrap()
            );
            assert!(!exists(f2.to_str().unwrap().into()).await.unwrap());
            assert!(exists(f3.to_str().unwrap().into()).await.unwrap());

            assert!(create_directory(new_dir.to_str().unwrap().into()).await.unwrap());
            assert!(exists(new_dir.to_str().unwrap().into()).await.unwrap());

            let dest_moved = new_dir.join("f3.txt");
            assert!(
                move_file(
                    f3.to_str().unwrap().into(),
                    dest_moved.to_str().unwrap().into()
                )
                .await
                .unwrap()
            );
            assert!(exists(dest_moved.to_str().unwrap().into()).await.unwrap());

            let list = list_dir(new_dir.to_str().unwrap().into()).await.unwrap();
            assert_eq!(list.len(), 1);
            assert_eq!(list[0].name, "f3.txt");
        });
    }

    #[test]
    fn test_watch_start_and_stop_with_state_keeps_watcher_alive_across_clones() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let events = Arc::new(Mutex::new(Vec::new()));
            let ev_clone = Arc::clone(&events);
            let watchers = Watchers::new(
                Arc::new(move |e| ev_clone.lock().unwrap().push(e)),
                Duration::from_millis(50),
            );

            let id = watch_start_with_state(
                watchers.clone(),
                temp.path().to_str().unwrap().to_string(),
            )
            .await;
            assert!(id >= 1);

            std::fs::write(temp.path().join("async_watched.txt"), "hi").unwrap();
            std::thread::sleep(Duration::from_millis(200));
            assert!(
                !events.lock().unwrap().is_empty(),
                "watcher started via cloned Watchers must remain active"
            );

            watch_stop_with_state(watchers.clone(), id).await;
        });
    }

    #[test]
    fn test_trash_file_if_available() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let f = temp.path().join("trash_candidate.txt");
            std::fs::write(&f, "trash me").unwrap();
            if let Ok(res) = trash_file(f.to_str().unwrap().into()).await {
                assert!(res);
                assert!(!f.exists());
            }
        });
    }

    #[test]
    fn test_get_places_and_read_text_preview_commands() {
        tauri::async_runtime::block_on(async {
            let places = get_places().await.unwrap();
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

            let preview = read_text_preview(f.to_str().unwrap().into()).await;
            assert_eq!(
                preview,
                TextPreview::Text {
                    content: "hello preview".to_string()
                }
            );

            let err_preview = read_text_preview("/nonexistent/file/path".into()).await;
            assert_eq!(err_preview, TextPreview::Error);
        });
    }

    #[test]
    fn test_trash_lifecycle_list_restore_with_collision_and_missing_parent_and_purge() {
        tauri::async_runtime::block_on(async {
            let temp = tempfile::tempdir().unwrap();
            let nested_parent = temp.path().join("deleted_parent");
            let missing_parent = temp.path().join("removed_dir").join("deep");
            std::fs::create_dir_all(&nested_parent).unwrap();
            std::fs::create_dir_all(&missing_parent).unwrap();

            let file_a = nested_parent.join("note.txt");
            std::fs::write(&file_a, "first version").unwrap();

            if trash_file(file_a.to_str().unwrap().into()).await.is_err() {
                return;
            }
            assert!(!file_a.exists());

            std::fs::write(&file_a, "blocking version").unwrap();
            let file_b = nested_parent.join("purge_me.txt");
            std::fs::write(&file_b, "to be purged").unwrap();
            trash_file(file_b.to_str().unwrap().into()).await.unwrap();

            let file_c = missing_parent.join("recreate.txt");
            std::fs::write(&file_c, "recreate parent").unwrap();
            trash_file(file_c.to_str().unwrap().into()).await.unwrap();
            std::fs::remove_dir_all(temp.path().join("removed_dir")).unwrap();
            assert!(!missing_parent.exists());

            let all_trashed = list_trash().await.unwrap();
            let nested_parent_str = nested_parent.to_string_lossy().into_owned();
            let missing_parent_str = missing_parent.to_string_lossy().into_owned();
            let entry_a = all_trashed
                .iter()
                .find(|e| {
                    e.name == "note.txt"
                        && e.original_parent.as_deref() == Some(nested_parent_str.as_str())
                })
                .expect("trashed note.txt must appear in list_trash");
            let entry_b = all_trashed
                .iter()
                .find(|e| {
                    e.name == "purge_me.txt"
                        && e.original_parent.as_deref() == Some(nested_parent_str.as_str())
                })
                .expect("trashed purge_me.txt must appear in list_trash");
            let entry_c = all_trashed
                .iter()
                .find(|e| {
                    e.name == "recreate.txt"
                        && e.original_parent.as_deref() == Some(missing_parent_str.as_str())
                })
                .expect("trashed recreate.txt must appear in list_trash");

            let id_a = entry_a.trash_id.clone().expect("must have trash_id");
            let id_b = entry_b.trash_id.clone().expect("must have trash_id");
            let id_c = entry_c.trash_id.clone().expect("must have trash_id");

            assert!(restore_trash_items(vec![id_a]).await.unwrap());
            let restored_collision = nested_parent.join("note (restored).txt");
            assert_eq!(
                std::fs::read_to_string(&restored_collision).unwrap(),
                "first version"
            );
            assert_eq!(
                std::fs::read_to_string(&file_a).unwrap(),
                "blocking version"
            );

            assert!(restore_trash_items(vec![id_c]).await.unwrap());
            assert_eq!(std::fs::read_to_string(&file_c).unwrap(), "recreate parent");

            assert!(purge_trash_items(vec![id_b.clone()]).await.unwrap());
            assert!(!nested_parent.join("purge_me.txt").exists());
            let after_purge = list_trash().await.unwrap();
            assert!(!after_purge
                .iter()
                .any(|e| e.trash_id.as_deref() == Some(id_b.as_str())));
        });
    }
}
