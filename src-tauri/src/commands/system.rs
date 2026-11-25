use crate::fs_ops::FileEntry;
use crate::scan_cancel::ScanCancellationState;
use crate::search::{self, SearchOptions};
use crate::system_info::{self, Drive, StorageUsage};
use std::sync::atomic::Ordering;
use std::sync::Arc;

#[tauri::command(rename_all = "camelCase")]
pub async fn get_drives() -> Vec<Drive> {
    tauri::async_runtime::spawn_blocking(system_info::get_drives)
        .await
        .unwrap_or_default()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_storage_usage() -> Option<StorageUsage> {
    tauri::async_runtime::spawn_blocking(system_info::get_storage_usage)
        .await
        .ok()
        .flatten()
}

pub async fn get_directory_size_with_state(state: &ScanCancellationState, path: String) -> u64 {
    let (seq, seq_ref) = state.next_dir_size_token();
    let sem = Arc::clone(&state.dir_size_semaphore);
    let Ok(_permit) = sem.acquire_owned().await else {
        return 0;
    };
    if seq_ref.load(Ordering::Relaxed) != seq {
        return 0;
    }
    tauri::async_runtime::spawn_blocking(move || {
        system_info::directory_size_bounded(&path, &|| seq_ref.load(Ordering::Relaxed) != seq)
    })
    .await
    .unwrap_or(0)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_directory_size(
    state: tauri::State<'_, ScanCancellationState>,
    path: String,
) -> Result<u64, String> {
    Ok(get_directory_size_with_state(state.inner(), path).await)
}

pub async fn search_with_state(
    state: &ScanCancellationState,
    directory: String,
    query: String,
    options: Option<SearchOptions>,
) -> Vec<FileEntry> {
    let (seq, seq_ref) = state.next_search_token();
    let sem = Arc::clone(&state.search_semaphore);
    let Ok(_permit) = sem.acquire_owned().await else {
        return Vec::new();
    };
    if seq_ref.load(Ordering::Relaxed) != seq {
        return Vec::new();
    }
    let opts = options.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        search::search_cancellable(&directory, &query, &opts, &|| {
            seq_ref.load(Ordering::Relaxed) != seq
        })
    })
    .await
    .unwrap_or_default()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn search(
    state: tauri::State<'_, ScanCancellationState>,
    directory: String,
    query: String,
    options: Option<SearchOptions>,
) -> Result<Vec<FileEntry>, String> {
    Ok(search_with_state(state.inner(), directory, query, options).await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_video_metadata(path: String) -> Option<crate::thumbnails::VideoMetadata> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::thumbnails::probe_video_metadata(std::path::Path::new(&path))
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commands_wire_correctly() {
        tauri::async_runtime::block_on(async {
            let state = ScanCancellationState::default();
            let temp = tempfile::tempdir().unwrap();
            let path = temp.path().to_string_lossy().into_owned();

            let size = get_directory_size_with_state(&state, path.clone()).await;
            assert_eq!(size, 0);

            let results = search_with_state(&state, path.clone(), "".to_string(), None).await;
            assert!(results.is_empty());

            let _ = get_drives().await;
            let _ = get_storage_usage().await;
            assert!(get_video_metadata(path).await.is_none());
        });
    }

    #[test]
    fn superseded_search_and_dir_size_return_early_after_semaphore_wait() {
        tauri::async_runtime::block_on(async {
            let state = ScanCancellationState::default();
            let temp = tempfile::tempdir().unwrap();
            std::fs::write(temp.path().join("hit.txt"), b"1234567890").unwrap();
            let path = temp.path().to_string_lossy().into_owned();

            // Exhaust both permits on search_semaphore so the first search blocks waiting
            let p1 = state.search_semaphore.clone().acquire_owned().await.unwrap();
            let p2 = state.search_semaphore.clone().acquire_owned().await.unwrap();

            let state_arc = Arc::new(state);
            let s_clone = Arc::clone(&state_arc);
            let path_clone = path.clone();
            let first = tauri::async_runtime::spawn(async move {
                search_with_state(&s_clone, path_clone, "hit".to_string(), None).await
            });

            // Wait briefly for `first` to acquire its token and block on semaphore
            std::thread::sleep(std::time::Duration::from_millis(20));

            // Supersede the token, then release semaphore permits
            let _ = state_arc.next_search_token();
            drop(p1);
            drop(p2);

            let first_results = first.await.unwrap();
            assert!(
                first_results.is_empty(),
                "superseded search should abort immediately after acquiring permit"
            );
        });
    }
}
