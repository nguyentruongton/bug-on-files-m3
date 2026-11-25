use std::process::{Command, Output};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcError {
    Spawn(String),
    Timeout,
    Io(String),
}

impl std::fmt::Display for ProcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProcError::Spawn(msg) => write!(f, "Failed to spawn process: {}", msg),
            ProcError::Timeout => write!(f, "Process timed out"),
            ProcError::Io(msg) => write!(f, "Process I/O error: {}", msg),
        }
    }
}

impl std::error::Error for ProcError {}

fn kill_child_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        let pgid = child.id();
        if pgid > 0 {
            let _ = Command::new("kill")
                .args(["-9", &format!("-{}", pgid)])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn run_command_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, ProcError> {
    cmd.stdin(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let mut child = cmd.spawn().map_err(|e| ProcError::Spawn(e.to_string()))?;

    let stdout_handle = child.stdout.take().map(|mut out| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut out, &mut buf);
            buf
        })
    });
    let stderr_handle = child.stderr.take().map(|mut err| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = std::io::Read::read_to_end(&mut err, &mut buf);
            buf
        })
    });

    let start = Instant::now();
    let poll_interval = Duration::from_millis(25);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = stdout_handle
                    .map(|h| h.join().unwrap_or_default())
                    .unwrap_or_default();
                let stderr = stderr_handle
                    .map(|h| h.join().unwrap_or_default())
                    .unwrap_or_default();
                return Ok(Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    kill_child_tree(&mut child);
                    if let Some(h) = stdout_handle {
                        let _ = h.join();
                    }
                    if let Some(h) = stderr_handle {
                        let _ = h.join();
                    }
                    return Err(ProcError::Timeout);
                }
                std::thread::sleep(poll_interval);
            }
            Err(e) => {
                kill_child_tree(&mut child);
                if let Some(h) = stdout_handle {
                    let _ = h.join();
                }
                if let Some(h) = stderr_handle {
                    let _ = h.join();
                }
                return Err(ProcError::Io(e.to_string()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    #[test]
    fn fast_command_succeeds_and_captures_stdout() {
        let mut cmd = Command::new("echo");
        cmd.arg("hello-proc")
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let out = run_command_with_timeout(cmd, Duration::from_secs(2)).expect("echo should succeed");
        assert!(out.status.success());
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "hello-proc");
    }

    #[test]
    fn slow_command_times_out_and_is_reaped() {
        let mut cmd = Command::new("sleep");
        cmd.arg("5")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let err = run_command_with_timeout(cmd, Duration::from_millis(60)).unwrap_err();
        assert_eq!(err, ProcError::Timeout);
    }

    #[test]
    fn missing_binary_returns_spawn_error() {
        let cmd = Command::new("/definitely/nonexistent/binary_proc_exec_test");
        let err = run_command_with_timeout(cmd, Duration::from_secs(1)).unwrap_err();
        assert!(matches!(err, ProcError::Spawn(_)));
    }

    #[test]
    #[cfg(unix)]
    fn timeout_reaps_grandchild_holding_stdout_without_hanging() {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 5 & wait"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let start = Instant::now();
        let err = run_command_with_timeout(cmd, Duration::from_millis(80)).unwrap_err();
        assert_eq!(err, ProcError::Timeout);
        assert!(
            start.elapsed() < Duration::from_secs(1),
            "timeout must return promptly even when grandchild holds stdout open (took {:?})",
            start.elapsed()
        );
    }
}
