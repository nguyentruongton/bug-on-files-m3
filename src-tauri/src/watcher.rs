use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum WatchEvent {
    Change { id: u32 },
    Error { id: u32, message: String },
}

enum DebounceSignal {
    Event,
    Stop,
}

struct WatcherEntry {
    _watcher: notify::RecommendedWatcher,
    stopped: Arc<AtomicBool>,
    trigger_tx: mpsc::Sender<DebounceSignal>,
    worker_handle: Option<std::thread::JoinHandle<()>>,
}

pub struct Watchers {
    emit: Arc<dyn Fn(WatchEvent) + Send + Sync>,
    debounce: Duration,
    next_id: AtomicU32,
    entries: Mutex<HashMap<u32, WatcherEntry>>,
}

impl Watchers {
    pub const DEFAULT_DEBOUNCE: Duration = Duration::from_millis(150);

    pub fn new(emit: Arc<dyn Fn(WatchEvent) + Send + Sync>, debounce: Duration) -> Self {
        Self {
            emit,
            debounce,
            next_id: AtomicU32::new(1),
            entries: Mutex::new(HashMap::new()),
        }
    }

    pub fn with_default_debounce(emit: Arc<dyn Fn(WatchEvent) + Send + Sync>) -> Self {
        Self::new(emit, Self::DEFAULT_DEBOUNCE)
    }

    pub fn start(&self, dir: &str) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let path = PathBuf::from(dir);

        // Fail early if directory doesn't exist
        if !path.exists() {
            (self.emit)(WatchEvent::Error {
                id,
                message: format!("Directory does not exist: {}", dir),
            });
            return id;
        }

        let dir_path = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let stopped = Arc::new(AtomicBool::new(false));
        let deleted_emitted = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel::<DebounceSignal>();

        let tx_for_notify = tx.clone();
        let stopped_for_notify = Arc::clone(&stopped);
        let deleted_emitted_for_notify = Arc::clone(&deleted_emitted);
        let emit_for_notify = Arc::clone(&self.emit);
        let dir_path_for_notify = dir_path.clone();
        let raw_path_for_notify = path.clone();

        use notify::Watcher;
        let watcher_res = notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                if stopped_for_notify.load(Ordering::SeqCst) {
                    return;
                }

                let is_deletion_or_err = match &res {
                    Err(_) => true,
                    Ok(event) => {
                        let deleted = !dir_path_for_notify.exists()
                            && !raw_path_for_notify.exists();
                        let dir_removed = event.paths.iter().any(|p| {
                            p == &dir_path_for_notify || p == &raw_path_for_notify
                        }) && matches!(
                            event.kind,
                            notify::EventKind::Remove(_)
                        );
                        deleted || dir_removed
                    }
                };

                if is_deletion_or_err {
                    if !deleted_emitted_for_notify.swap(true, Ordering::SeqCst) {
                        stopped_for_notify.store(true, Ordering::SeqCst);
                        let _ = tx_for_notify.send(DebounceSignal::Stop);
                        let message = match res {
                            Err(e) => e.to_string(),
                            Ok(_) => format!(
                                "Watched directory was deleted: {}",
                                dir_path_for_notify.display()
                            ),
                        };
                        emit_for_notify(WatchEvent::Error { id, message });
                    }
                    return;
                }

                // Normal change event inside the directory
                let _ = tx_for_notify.send(DebounceSignal::Event);
            },
        );

        let mut watcher = match watcher_res {
            Ok(w) => w,
            Err(e) => {
                (self.emit)(WatchEvent::Error {
                    id,
                    message: e.to_string(),
                });
                return id;
            }
        };

        if let Err(e) = watcher.watch(&dir_path, notify::RecursiveMode::NonRecursive) {
            (self.emit)(WatchEvent::Error {
                id,
                message: e.to_string(),
            });
            return id;
        }

        let emit_for_worker = Arc::clone(&self.emit);
        let stopped_for_worker = Arc::clone(&stopped);
        let debounce = self.debounce;

        let worker_handle = std::thread::spawn(move || {
            while let Ok(signal) = rx.recv() {
                match signal {
                    DebounceSignal::Stop => break,
                    DebounceSignal::Event => {
                        if stopped_for_worker.load(Ordering::SeqCst) {
                            break;
                        }
                        let mut timed_out = false;
                        while !timed_out {
                            match rx.recv_timeout(debounce) {
                                Ok(DebounceSignal::Stop) => return,
                                Ok(DebounceSignal::Event) => {
                                    if stopped_for_worker.load(Ordering::SeqCst) {
                                        return;
                                    }
                                }
                                Err(mpsc::RecvTimeoutError::Timeout) => {
                                    timed_out = true;
                                }
                                Err(mpsc::RecvTimeoutError::Disconnected) => {
                                    return;
                                }
                            }
                        }
                        if !stopped_for_worker.load(Ordering::SeqCst) {
                            emit_for_worker(WatchEvent::Change { id });
                        }
                    }
                }
            }
        });

        let entry = WatcherEntry {
            _watcher: watcher,
            stopped,
            trigger_tx: tx,
            worker_handle: Some(worker_handle),
        };

        self.entries.lock().unwrap().insert(id, entry);
        id
    }

    pub fn stop(&self, id: u32) {
        let entry = {
            let mut lock = self.entries.lock().unwrap();
            lock.remove(&id)
        };

        if let Some(mut entry) = entry {
            entry.stopped.store(true, Ordering::SeqCst);
            let _ = entry.trigger_tx.send(DebounceSignal::Stop);
            if let Some(handle) = entry.worker_handle.take() {
                if handle.thread().id() != std::thread::current().id() {
                    let _ = handle.join();
                }
            }
        }
    }

    pub fn stop_all(&self) {
        let entries = {
            let mut lock = self.entries.lock().unwrap();
            std::mem::take(&mut *lock)
        };

        for (_id, mut entry) in entries {
            entry.stopped.store(true, Ordering::SeqCst);
            let _ = entry.trigger_tx.send(DebounceSignal::Stop);
            if let Some(handle) = entry.worker_handle.take() {
                if handle.thread().id() != std::thread::current().id() {
                    let _ = handle.join();
                }
            }
        }
    }
}

impl Drop for Watchers {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wait_for_events<F>(
        events: &Arc<Mutex<Vec<WatchEvent>>>,
        timeout: Duration,
        condition: F,
    ) -> Vec<WatchEvent>
    where
        F: Fn(&[WatchEvent]) -> bool,
    {
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            {
                let lock = events.lock().unwrap();
                if condition(&lock) {
                    return lock.clone();
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        events.lock().unwrap().clone()
    }

    #[test]
    fn test_watch_event_json_serialization() {
        let change = WatchEvent::Change { id: 1 };
        let json_change = serde_json::to_string(&change).unwrap();
        assert_eq!(json_change, r#"{"type":"change","id":1}"#);

        let err = WatchEvent::Error {
            id: 2,
            message: "dir not found".to_string(),
        };
        let json_err = serde_json::to_string(&err).unwrap();
        assert_eq!(json_err, r#"{"type":"error","id":2,"message":"dir not found"}"#);

        let deserialized_change: WatchEvent = serde_json::from_str(&json_change).unwrap();
        assert_eq!(deserialized_change, change);

        let deserialized_err: WatchEvent = serde_json::from_str(&json_err).unwrap();
        assert_eq!(deserialized_err, err);
    }

    #[test]
    fn test_stop_unknown_id_is_noop() {
        let events = Arc::new(Mutex::new(Vec::<WatchEvent>::new()));
        let watchers = Watchers::new(Arc::new(move |_| {}), Duration::from_millis(50));
        watchers.stop(99999);
        watchers.stop(0);
        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn test_creating_a_file_emits_exactly_one_change_for_that_id_within_500ms() {
        let temp = tempfile::tempdir().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let ev_clone = Arc::clone(&events);
        let watchers = Watchers::new(
            Arc::new(move |e| ev_clone.lock().unwrap().push(e)),
            Duration::from_millis(50),
        );

        let id = watchers.start(temp.path().to_str().unwrap());
        std::fs::write(temp.path().join("test.txt"), "content").unwrap();

        let list = wait_for_events(&events, Duration::from_millis(500), |evs| !evs.is_empty());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0], WatchEvent::Change { id });
    }

    #[test]
    fn test_creating_50_files_in_a_tight_loop_emits_le_3_change_events() {
        let temp = tempfile::tempdir().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let ev_clone = Arc::clone(&events);
        let watchers = Watchers::new(
            Arc::new(move |e| ev_clone.lock().unwrap().push(e)),
            Duration::from_millis(50),
        );

        let id = watchers.start(temp.path().to_str().unwrap());
        for i in 0..50 {
            std::fs::write(
                temp.path().join(format!("file-{}.txt", i)),
                format!("data-{}", i),
            )
            .unwrap();
        }

        let list = wait_for_events(&events, Duration::from_millis(500), |evs| !evs.is_empty());
        assert!(
            !list.is_empty() && list.len() <= 3,
            "expected 1..=3 events, got {}",
            list.len()
        );
        for e in list {
            assert_eq!(e, WatchEvent::Change { id });
        }
    }

    #[test]
    fn test_after_stop_id_creating_a_file_emits_nothing_calling_stop_twice_does_not_throw() {
        let temp = tempfile::tempdir().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let ev_clone = Arc::clone(&events);
        let watchers = Watchers::new(
            Arc::new(move |e| ev_clone.lock().unwrap().push(e)),
            Duration::from_millis(50),
        );

        let id = watchers.start(temp.path().to_str().unwrap());
        watchers.stop(id);
        watchers.stop(id); // second stop does not throw/panic

        std::fs::write(temp.path().join("after-stop.txt"), "hello").unwrap();
        std::thread::sleep(Duration::from_millis(200));

        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn test_start_nonexistent_xyz_emits_one_error_event_and_returns_an_id_stop_id_is_safe() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let ev_clone = Arc::clone(&events);
        let watchers = Watchers::new(
            Arc::new(move |e| ev_clone.lock().unwrap().push(e)),
            Duration::from_millis(50),
        );

        let nonexistent = format!(
            "/tmp/nonexistent-xyz-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let id = watchers.start(&nonexistent);
        assert!(id >= 1);

        let list = wait_for_events(&events, Duration::from_millis(200), |evs| !evs.is_empty());
        assert_eq!(list.len(), 1);
        match &list[0] {
            WatchEvent::Error { id: err_id, message } => {
                assert_eq!(*err_id, id);
                assert!(!message.is_empty());
            }
            _ => panic!("expected Error event"),
        }

        watchers.stop(id);
    }

    #[test]
    fn test_deleting_the_watched_directory_emits_an_error_or_change_event_and_does_not_throw() {
        let temp = tempfile::tempdir().unwrap();
        let target_dir = temp.path().join("watched_subdir");
        std::fs::create_dir(&target_dir).unwrap();

        let events = Arc::new(Mutex::new(Vec::new()));
        let ev_clone = Arc::clone(&events);
        let watchers = Watchers::new(
            Arc::new(move |e| ev_clone.lock().unwrap().push(e)),
            Duration::from_millis(50),
        );

        let id = watchers.start(target_dir.to_str().unwrap());
        std::fs::remove_dir(&target_dir).unwrap();

        let list = wait_for_events(&events, Duration::from_millis(500), |evs| !evs.is_empty());
        assert!(
            !list.is_empty(),
            "expected at least 1 event when watched directory is deleted"
        );
        match &list[0] {
            WatchEvent::Change { id: eid } | WatchEvent::Error { id: eid, .. } => {
                assert_eq!(*eid, id);
            }
        }

        watchers.stop(id);
    }

    #[test]
    fn test_watching_deleted_directory_emits_one_error() {
        let temp = tempfile::tempdir().unwrap();
        let target_dir = temp.path().join("deleted_subdir");
        std::fs::create_dir(&target_dir).unwrap();

        let events = Arc::new(Mutex::new(Vec::new()));
        let ev_clone = Arc::clone(&events);
        let watchers = Watchers::new(
            Arc::new(move |e| ev_clone.lock().unwrap().push(e)),
            Duration::from_millis(50),
        );

        let id = watchers.start(target_dir.to_str().unwrap());
        std::fs::remove_dir(&target_dir).unwrap();

        let list = wait_for_events(&events, Duration::from_millis(500), |evs| !evs.is_empty());
        assert_eq!(list.len(), 1, "expected exactly 1 error event, got {:?}", list);
        match &list[0] {
            WatchEvent::Error { id: eid, message } => {
                assert_eq!(*eid, id);
                assert!(!message.is_empty());
            }
            other => panic!("expected Error event, got {:?}", other),
        }

        // Wait another 100ms to verify no further events are emitted
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(events.lock().unwrap().len(), 1);

        watchers.stop(id);
    }

    #[test]
    fn test_stop_all_stops_every_watcher() {
        let temp = tempfile::tempdir().unwrap();
        let dir1 = temp.path().join("dir1");
        let dir2 = temp.path().join("dir2");
        std::fs::create_dir(&dir1).unwrap();
        std::fs::create_dir(&dir2).unwrap();

        let events = Arc::new(Mutex::new(Vec::new()));
        let ev_clone = Arc::clone(&events);
        let watchers = Watchers::new(
            Arc::new(move |e| ev_clone.lock().unwrap().push(e)),
            Duration::from_millis(50),
        );

        let _id1 = watchers.start(dir1.to_str().unwrap());
        let _id2 = watchers.start(dir2.to_str().unwrap());
        watchers.stop_all();

        std::fs::write(dir1.join("file1.txt"), "a").unwrap();
        std::fs::write(dir2.join("file2.txt"), "b").unwrap();
        std::thread::sleep(Duration::from_millis(200));

        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn test_uses_default_debounce_of_150ms_when_unspecified() {
        let temp = tempfile::tempdir().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let ev_clone = Arc::clone(&events);
        let watchers = Watchers::with_default_debounce(Arc::new(move |e| {
            ev_clone.lock().unwrap().push(e)
        }));

        let id = watchers.start(temp.path().to_str().unwrap());
        std::fs::write(temp.path().join("default-debounce.txt"), "data").unwrap();

        std::thread::sleep(Duration::from_millis(50));
        assert!(events.lock().unwrap().is_empty());

        let list = wait_for_events(&events, Duration::from_millis(300), |evs| !evs.is_empty());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0], WatchEvent::Change { id });
    }
}
