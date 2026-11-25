use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;

pub struct ScanCancellationState {
    search_seq: Arc<AtomicU64>,
    dir_size_seq: Arc<AtomicU64>,
    pub search_semaphore: Arc<Semaphore>,
    pub dir_size_semaphore: Arc<Semaphore>,
}

impl Default for ScanCancellationState {
    fn default() -> Self {
        Self {
            search_seq: Arc::new(AtomicU64::new(0)),
            dir_size_seq: Arc::new(AtomicU64::new(0)),
            search_semaphore: Arc::new(Semaphore::new(2)),
            dir_size_semaphore: Arc::new(Semaphore::new(2)),
        }
    }
}

impl ScanCancellationState {
    pub fn next_search_token(&self) -> (u64, Arc<AtomicU64>) {
        let seq = self.search_seq.fetch_add(1, Ordering::SeqCst) + 1;
        (seq, Arc::clone(&self.search_seq))
    }

    pub fn next_dir_size_token(&self) -> (u64, Arc<AtomicU64>) {
        let seq = self.dir_size_seq.fetch_add(1, Ordering::SeqCst) + 1;
        (seq, Arc::clone(&self.dir_size_seq))
    }
}

pub fn is_pseudo_fs_path(path: &Path) -> bool {
    if path.starts_with("/proc") || path.starts_with("/sys") || path.starts_with("/dev") {
        return true;
    }
    if path.starts_with("/run") && path != Path::new("/run") && !path.starts_with("/run/media") {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_tokens_supersede_previous_tokens() {
        let state = ScanCancellationState::default();

        let (s1, s_ref1) = state.next_search_token();
        assert_eq!(s_ref1.load(Ordering::Relaxed), s1);
        let (s2, s_ref2) = state.next_search_token();
        assert_ne!(s1, s2);
        assert_ne!(s_ref1.load(Ordering::Relaxed), s1);
        assert_eq!(s_ref2.load(Ordering::Relaxed), s2);

        let (d1, d_ref1) = state.next_dir_size_token();
        assert_eq!(d_ref1.load(Ordering::Relaxed), d1);
        let (d2, d_ref2) = state.next_dir_size_token();
        assert_ne!(d1, d2);
        assert_ne!(d_ref1.load(Ordering::Relaxed), d1);
        assert_eq!(d_ref2.load(Ordering::Relaxed), d2);
    }

    #[test]
    fn is_pseudo_fs_path_skips_kernel_virtual_fs_and_preserves_run_media() {
        assert!(is_pseudo_fs_path(Path::new("/proc")));
        assert!(is_pseudo_fs_path(Path::new("/proc/1")));
        assert!(is_pseudo_fs_path(Path::new("/sys/class")));
        assert!(is_pseudo_fs_path(Path::new("/dev/pts")));
        assert!(is_pseudo_fs_path(Path::new("/run/user/1000")));
        assert!(is_pseudo_fs_path(Path::new("/run/udev/data")));

        assert!(!is_pseudo_fs_path(Path::new("/run")));
        assert!(!is_pseudo_fs_path(Path::new("/run/media")));
        assert!(!is_pseudo_fs_path(Path::new("/run/media/user/USB")));
        assert!(!is_pseudo_fs_path(Path::new("/home/user")));
        assert!(!is_pseudo_fs_path(Path::new("/process")));
    }
}
