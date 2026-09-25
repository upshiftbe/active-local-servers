use std::thread;
use std::time::{Duration, Instant};

use nix::errno::Errno;
use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use serde::Serialize;

const GRACE_PERIOD: Duration = Duration::from_secs(3);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Serialize)]
pub struct KillResponse {
    pub success: bool,
    pub message: String,
}

impl KillResponse {
    pub fn ok(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
        }
    }
}

fn is_alive(pid: Pid) -> bool {
    // Signal 0 performs error checking only. EPERM still means the process exists.
    !matches!(kill(pid, None), Err(Errno::ESRCH))
}

/// Sends SIGTERM, waits up to `GRACE_PERIOD` for the process to exit, then SIGKILLs it.
pub fn stop_process(pid: u32, name: &str) -> KillResponse {
    let target = Pid::from_raw(pid as i32);

    match kill(target, Signal::SIGTERM) {
        Ok(()) => {}
        Err(Errno::ESRCH) => {
            return KillResponse::err(format!("Process PID {pid} is no longer running."))
        }
        Err(Errno::EPERM) => {
            return KillResponse::err(format!("Not permitted to stop {name} (PID {pid})."))
        }
        Err(error) => {
            return KillResponse::err(format!("Failed to stop {name} (PID {pid}): {error}."))
        }
    }

    let deadline = Instant::now() + GRACE_PERIOD;
    while Instant::now() < deadline {
        if !is_alive(target) {
            return KillResponse::ok(format!("Stopped {name} (PID {pid})."));
        }
        thread::sleep(POLL_INTERVAL);
    }

    match kill(target, Signal::SIGKILL) {
        Ok(()) | Err(Errno::ESRCH) => KillResponse::ok(format!(
            "Force-stopped {name} (PID {pid}) after it ignored SIGTERM."
        )),
        Err(error) => {
            KillResponse::err(format!("Failed to force-stop {name} (PID {pid}): {error}."))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command};

    /// Reaps the child in the background so it doesn't linger as a zombie (which `kill(pid, 0)` still sees).
    fn spawn_reaped(mut command: Command) -> u32 {
        let mut child: Child = command.spawn().expect("failed to spawn test process");
        let pid = child.id();
        thread::spawn(move || child.wait());
        thread::sleep(Duration::from_millis(200));
        pid
    }

    #[test]
    fn stops_process_gracefully() {
        let mut command = Command::new("sleep");
        command.arg("30");
        let pid = spawn_reaped(command);

        let started = Instant::now();
        let result = stop_process(pid, "sleep");
        assert!(result.success, "{}", result.message);
        assert!(result.message.starts_with("Stopped"));
        assert!(started.elapsed() < GRACE_PERIOD);
    }

    #[test]
    fn force_kills_process_that_ignores_sigterm() {
        let mut command = Command::new("sh");
        command.args(["-c", "trap '' TERM; while true; do sleep 1; done"]);
        let pid = spawn_reaped(command);

        let result = stop_process(pid, "sh");
        assert!(result.success, "{}", result.message);
        assert!(result.message.starts_with("Force-stopped"));
    }

    #[test]
    fn reports_missing_process() {
        let result = stop_process(999_999, "ghost");
        assert!(!result.success);
    }
}
