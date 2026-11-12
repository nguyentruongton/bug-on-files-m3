use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub fn decode_utf8_with_remainder(mut bytes: &[u8]) -> (String, Vec<u8>) {
    let mut out = String::new();
    while !bytes.is_empty() {
        match std::str::from_utf8(bytes) {
            Ok(s) => {
                out.push_str(s);
                return (out, Vec::new());
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to > 0 {
                    out.push_str(&String::from_utf8_lossy(&bytes[..valid_up_to]));
                    bytes = &bytes[valid_up_to..];
                }
                match err.error_len() {
                    None => {
                        return (out, bytes.to_vec());
                    }
                    Some(len) => {
                        out.push('\u{FFFD}');
                        bytes = &bytes[len..];
                    }
                }
            }
        }
    }
    (out, Vec::new())
}

struct SessionEntry {
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

pub struct PtySessions {
    sessions: Arc<Mutex<HashMap<u32, SessionEntry>>>,
}

impl PtySessions {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn(
        &self,
        cwd: &str,
        on_data: Arc<dyn Fn(u32, String) + Send + Sync>,
        on_exit: Arc<dyn Fn(u32) + Send + Sync>,
    ) -> Result<u32, String> {
        let working_dir = if cwd.trim().is_empty() {
            dirs::home_dir().unwrap_or_else(|| {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
            })
        } else {
            PathBuf::from(cwd)
        };

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new("bash");
        cmd.cwd(working_dir);
        cmd.env("TERM", "xterm-256color");

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        let pid = child
            .process_id()
            .ok_or_else(|| "Failed to obtain process ID".to_string())?;

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let killer = child.clone_killer();

        let exit_fired = Arc::new(AtomicBool::new(false));
        let writer_arc = Arc::new(Mutex::new(Some(writer)));
        let master_arc = Arc::new(Mutex::new(pair.master));
        let killer_arc = Arc::new(Mutex::new(killer));

        let exit_fired_clone = Arc::clone(&exit_fired);
        let killer_clone = Arc::clone(&killer_arc);
        let writer_clone = Arc::clone(&writer_arc);
        let on_data_clone = Arc::clone(&on_data);
        let on_exit_clone = Arc::clone(&on_exit);
        let sessions_weak = Arc::downgrade(&self.sessions);

        let thread_handle = std::thread::spawn(move || {
            let mut reader = reader;
            let mut child = child;
            let mut buf = [0u8; 4096];
            let mut pending_bytes = Vec::new();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = &buf[..n];
                        let to_process = if pending_bytes.is_empty() {
                            chunk.to_vec()
                        } else {
                            let mut combined = std::mem::take(&mut pending_bytes);
                            combined.extend_from_slice(chunk);
                            combined
                        };

                        let (text, remainder) = decode_utf8_with_remainder(&to_process);
                        pending_bytes = remainder;
                        if !text.is_empty() {
                            (on_data_clone)(pid, text);
                        }
                    }
                    Err(_) => break,
                }
            }

            if !pending_bytes.is_empty() {
                let text = String::from_utf8_lossy(&pending_bytes).into_owned();
                if !text.is_empty() {
                    (on_data_clone)(pid, text);
                }
            }

            if let Ok(mut w) = writer_clone.lock() {
                w.take();
            }
            let _ = killer_clone.lock().map(|mut k| k.kill());
            let _ = child.wait();

            if !exit_fired_clone.swap(true, Ordering::SeqCst) {
                (on_exit_clone)(pid);
            }

            if let Some(sessions_arc) = sessions_weak.upgrade() {
                if let Ok(mut map) = sessions_arc.lock() {
                    map.remove(&pid);
                }
            }
        });

        let entry = SessionEntry {
            writer: writer_arc,
            master: master_arc,
            killer: killer_arc,
            thread_handle: Some(thread_handle),
        };

        self.sessions.lock().unwrap().insert(pid, entry);

        Ok(pid)
    }

    pub fn write(&self, pid: u32, data: &str) {
        let writer = {
            let map = self.sessions.lock().unwrap();
            map.get(&pid).map(|s| Arc::clone(&s.writer))
        };
        if let Some(writer) = writer {
            if let Ok(mut w_guard) = writer.lock() {
                if let Some(w) = w_guard.as_mut() {
                    let _ = w.write_all(data.as_bytes());
                    let _ = w.flush();
                }
            }
        }
    }

    pub fn resize(&self, pid: u32, cols: u16, rows: u16) {
        let master = {
            let map = self.sessions.lock().unwrap();
            map.get(&pid).map(|s| Arc::clone(&s.master))
        };
        if let Some(master) = master {
            if let Ok(m) = master.lock() {
                let _ = m.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
            }
        }
    }

    pub fn kill(&self, pid: u32) {
        let session = {
            let mut map = self.sessions.lock().unwrap();
            map.remove(&pid)
        };
        if let Some(mut session) = session {
            if let Ok(mut k) = session.killer.lock() {
                let _ = k.kill();
            }
            if let Ok(mut w) = session.writer.lock() {
                w.take();
            }
            if let Some(handle) = session.thread_handle.take() {
                if handle.thread().id() != std::thread::current().id() {
                    let _ = handle.join();
                }
            }
        }
    }

    pub fn kill_all(&self) {
        let sessions: Vec<SessionEntry> = {
            let mut map = self.sessions.lock().unwrap();
            map.drain().map(|(_, v)| v).collect()
        };
        for session in &sessions {
            if let Ok(mut k) = session.killer.lock() {
                let _ = k.kill();
            }
        }
        for session in &sessions {
            if let Ok(mut w) = session.writer.lock() {
                w.take();
            }
        }
        for mut session in sessions {
            if let Some(handle) = session.thread_handle.take() {
                if handle.thread().id() != std::thread::current().id() {
                    let _ = handle.join();
                }
            }
        }
    }
}

impl Default for PtySessions {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for PtySessions {
    fn drop(&mut self) {
        self.kill_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_utf8_remainder() {
        let (text, rem) = decode_utf8_with_remainder(b"hello world");
        assert_eq!(text, "hello world");
        assert!(rem.is_empty());

        let part1 = vec![0xE2, 0x82];
        let (text1, rem1) = decode_utf8_with_remainder(&part1);
        assert_eq!(text1, "");
        assert_eq!(rem1, vec![0xE2, 0x82]);

        let mut part2 = rem1;
        part2.push(0xAC);
        part2.extend_from_slice(b" done");
        let (text2, rem2) = decode_utf8_with_remainder(&part2);
        assert_eq!(text2, "€ done");
        assert!(rem2.is_empty());
    }

    #[test]
    fn spawned_shell_echoes_written_input() {
        let pty = PtySessions::new();
        let (data_tx, data_rx) = std::sync::mpsc::channel();
        let (exit_tx, _exit_rx) = std::sync::mpsc::channel();

        let on_data = Arc::new(move |_pid: u32, s: String| {
            let _ = data_tx.send(s);
        });
        let on_exit = Arc::new(move |_pid: u32| {
            let _ = exit_tx.send(());
        });

        let pid = pty.spawn("", on_data, on_exit).expect("spawn failed");
        assert!(pid > 0);

        pty.write(pid, "echo hi\n");

        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(2);
        let mut collected = String::new();
        let mut found = false;

        while start.elapsed() < timeout {
            match data_rx.recv_timeout(std::time::Duration::from_millis(50)) {
                Ok(chunk) => {
                    collected.push_str(&chunk);
                    if collected.contains("hi") {
                        found = true;
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        pty.write(pid, "exit\n");
        pty.kill(pid);

        assert!(found, "Expected output to contain 'hi', got: {:?}", collected);
    }

    #[test]
    fn exit_callback_fires_once_when_shell_exits() {
        let pty = PtySessions::new();
        let (data_tx, _data_rx) = std::sync::mpsc::channel();
        let (exit_tx, exit_rx) = std::sync::mpsc::channel();
        let exit_count = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let exit_count_clone = Arc::clone(&exit_count);

        let on_data = Arc::new(move |_pid: u32, _s: String| {
            let _ = data_tx.send(());
        });
        let on_exit = Arc::new(move |_pid: u32| {
            exit_count_clone.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let _ = exit_tx.send(());
        });

        let pid = pty.spawn("", on_data, on_exit).expect("spawn failed");
        pty.write(pid, "exit\n");

        let res = exit_rx.recv_timeout(std::time::Duration::from_secs(2));
        assert!(res.is_ok(), "Expected exit callback to fire within 2s");

        pty.kill(pid);
        std::thread::sleep(std::time::Duration::from_millis(100));

        assert_eq!(exit_count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn write_after_exit_does_not_panic() {
        let pty = PtySessions::new();
        let (exit_tx, exit_rx) = std::sync::mpsc::channel();

        let on_data = Arc::new(|_pid: u32, _s: String| {});
        let on_exit = Arc::new(move |_pid: u32| {
            let _ = exit_tx.send(());
        });

        let pid = pty.spawn("", on_data, on_exit).expect("spawn failed");
        pty.write(pid, "exit\n");

        let _ = exit_rx.recv_timeout(std::time::Duration::from_secs(2));
        std::thread::sleep(std::time::Duration::from_millis(50));

        pty.write(pid, "echo should not panic\n");
        pty.write(999_999, "echo should not panic\n");
        pty.resize(pid, 100, 40);
        pty.resize(999_999, 100, 40);
        pty.kill(pid);
        pty.kill(999_999);
    }

    #[test]
    fn kill_all_terminates_sessions() {
        let pty = PtySessions::new();
        let (exit_tx1, exit_rx1) = std::sync::mpsc::channel();
        let (exit_tx2, exit_rx2) = std::sync::mpsc::channel();

        let on_data = Arc::new(|_pid: u32, _s: String| {});
        let on_exit1 = Arc::new(move |_pid: u32| {
            let _ = exit_tx1.send(());
        });
        let on_exit2 = Arc::new(move |_pid: u32| {
            let _ = exit_tx2.send(());
        });

        let _pid1 = pty.spawn("", on_data.clone(), on_exit1).expect("spawn 1 failed");
        let _pid2 = pty.spawn("", on_data, on_exit2).expect("spawn 2 failed");

        pty.kill_all();

        let res1 = exit_rx1.recv_timeout(std::time::Duration::from_secs(2));
        let res2 = exit_rx2.recv_timeout(std::time::Duration::from_secs(2));

        assert!(res1.is_ok(), "Session 1 should have exited on kill_all");
        assert!(res2.is_ok(), "Session 2 should have exited on kill_all");

        pty.kill_all();
    }
}
