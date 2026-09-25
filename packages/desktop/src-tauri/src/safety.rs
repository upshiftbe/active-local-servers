const PROTECTED_PROCESS_NAMES: &[&str] = &[
    // macOS
    "launchd",
    "kernel_task",
    "windowserver",
    "controlcenter",
    "rapportd",
    "sharingd",
    "mdnsresponder",
    "loginwindow",
    "airplayxpchelper",
    "identityservicesd",
    "remoted",
    // Linux
    "systemd",
    "init",
    "sshd",
    "cupsd",
    "systemd-resolved",
    "avahi-daemon",
    "dbus-daemon",
    "networkmanager",
];

const PROXY_PROCESS_NAMES: &[&str] = &[
    "com.docker.backend",
    "com.docker.vpnkit",
    "docker",
    "docker-proxy",
    "dockerd",
    "vpnkit",
    "orbstack",
    "orbstack helper",
];

pub fn is_protected_pid(pid: u32) -> bool {
    pid <= 1
}

pub fn is_protected_process_name(name: &str) -> bool {
    PROTECTED_PROCESS_NAMES.contains(&name.to_lowercase().as_str())
}

pub fn is_proxy_process(name: &str) -> bool {
    let lower = name.to_lowercase();
    PROXY_PROCESS_NAMES.contains(&lower.as_str()) || lower.contains("docker") || lower.contains("orbstack")
}

#[derive(Debug, PartialEq, Eq)]
pub enum KillGuard {
    Allowed,
    Denied(String),
}

pub fn validate_kill_target(pid: u32, process_name: &str, self_pid: u32, owned_by_current_user: bool) -> KillGuard {
    if pid == self_pid {
        return KillGuard::Denied("Cannot stop the Active Local Servers app itself.".into());
    }

    if is_protected_pid(pid) {
        return KillGuard::Denied(format!("PID {pid} is a protected system process."));
    }

    if is_protected_process_name(process_name) {
        return KillGuard::Denied(format!("Process \"{process_name}\" is protected and cannot be stopped."));
    }

    if !owned_by_current_user {
        return KillGuard::Denied(format!("Process \"{process_name}\" (PID {pid}) belongs to another user."));
    }

    KillGuard::Allowed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_self_and_system_pids() {
        assert!(matches!(validate_kill_target(42, "node", 42, true), KillGuard::Denied(_)));
        assert!(matches!(validate_kill_target(1, "node", 42, true), KillGuard::Denied(_)));
        assert!(matches!(validate_kill_target(0, "node", 42, true), KillGuard::Denied(_)));
    }

    #[test]
    fn refuses_protected_names_case_insensitively() {
        assert!(matches!(validate_kill_target(500, "ControlCenter", 42, true), KillGuard::Denied(_)));
        assert!(matches!(validate_kill_target(500, "systemd", 42, true), KillGuard::Denied(_)));
    }

    #[test]
    fn refuses_other_users_processes() {
        assert!(matches!(validate_kill_target(500, "node", 42, false), KillGuard::Denied(_)));
    }

    #[test]
    fn allows_regular_dev_process() {
        assert_eq!(validate_kill_target(500, "node", 42, true), KillGuard::Allowed);
    }

    #[test]
    fn detects_proxy_processes() {
        assert!(is_proxy_process("com.docker.backend"));
        assert!(is_proxy_process("OrbStack Helper"));
        assert!(!is_proxy_process("node"));
    }
}
