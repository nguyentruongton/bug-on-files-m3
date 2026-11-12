use crate::fs_ops::FileEntry;
use crate::search::{self, SearchOptions};
use crate::system_info::{self, Drive, StorageUsage};

#[tauri::command(rename_all = "camelCase")]
pub fn get_drives() -> Vec<Drive> {
    system_info::get_drives()
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_storage_usage() -> Option<StorageUsage> {
    system_info::get_storage_usage()
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_directory_size(path: String) -> u64 {
    system_info::directory_size(&path)
}

#[tauri::command(rename_all = "camelCase")]
pub fn search(
    directory: String,
    query: String,
    options: Option<SearchOptions>,
) -> Vec<FileEntry> {
    search::search(&directory, &query, &options.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_commands_wire_correctly() {
        // Smoke test commands
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().to_string_lossy().into_owned();

        let size = get_directory_size(path.clone());
        assert_eq!(size, 0);

        let results = search(path, "".to_string(), None);
        assert!(results.is_empty());

        let _ = get_drives();
        let _ = get_storage_usage();
    }
}
