use std::collections::{BTreeMap, HashSet};
use std::net::IpAddr;
use std::path::Path;

use listeners::{Protocol, SocketState};
use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::safety::{is_protected_process_name, is_proxy_process};

const DEV_PORT_MIN: u16 = 1024;

const DEV_PROCESS_NAMES: &[&str] = &[
    "node",
    "python",
    "python3",
    "java",
    "dotnet",
    "php",
    "php-fpm",
    "ruby",
    "go",
    "deno",
    "bun",
    "nginx",
    "httpd",
    "caddy",
    "cargo",
    "rustc",
    "esbuild",
    "webpack",
    "vite",
    "uvicorn",
    "gunicorn",
    "hypercorn",
    "flask",
    "rails",
    "puma",
    "unicorn",
    "postgres",
    "mysqld",
    "mongod",
    "redis-server",
    "elixir",
    "beam.smp",
    "hugo",
    "jekyll",
    "air",
    "wrangler",
    "workerd",
    "miniflare",
    "turbo",
];

const DEV_COMMAND_HINTS: &[&str] = &[
    "vite",
    "next",
    "webpack",
    "express",
    "fastify",
    "nuxt",
    "remix",
    "astro",
    "http-server",
    "live-server",
    "tsx",
    "ts-node",
    "nodemon",
    "start-server",
    "dev-server",
    "npm run dev",
    "pnpm dev",
    "yarn dev",
    "bun dev",
    "http.server",
    "manage.py runserver",
    "flask run",
    "uvicorn",
    "rails s",
    "storybook",
    "jupyter",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub pid: u32,
    pub port: u16,
    pub host: String,
    pub name: String,
    pub path: Option<String>,
    pub command_line: Option<String>,
    pub is_self: bool,
    pub is_proxy: bool,
    pub sibling_ports: Vec<u16>,
    pub cwd: Option<String>,
    pub project: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RawListener {
    pub pid: u32,
    pub port: u16,
    pub host: String,
    pub name: String,
    pub path: Option<String>,
    pub command_line: Option<String>,
    pub cwd: Option<String>,
    pub owned_by_current_user: bool,
}

pub fn normalize_host(host: &str) -> String {
    let trimmed = host.trim_start_matches('[').trim_end_matches(']');
    match trimmed.parse::<IpAddr>() {
        Ok(IpAddr::V6(v6)) => match v6.to_ipv4_mapped() {
            Some(v4) => v4.to_string(),
            None => v6.to_string(),
        },
        Ok(ip) => ip.to_string(),
        Err(_) => trimmed.to_string(),
    }
}

pub fn is_allowed_host(host: &str) -> bool {
    matches!(
        normalize_host(host).as_str(),
        "127.0.0.1" | "0.0.0.0" | "::" | "::1" | "localhost"
    )
}

/// `python3.12` → `python3`, `Python` → `python`.
fn normalize_process_name(name: &str) -> String {
    let lower = name.to_lowercase();
    if let Some(stripped) = lower.strip_prefix("python3.") {
        if stripped.chars().all(|c| c.is_ascii_digit()) {
            return "python3".into();
        }
    }
    lower
}

pub fn looks_like_dev_server(listener: &RawListener) -> bool {
    let name = normalize_process_name(&listener.name);

    if DEV_PROCESS_NAMES.contains(&name.as_str()) {
        return true;
    }
    if is_proxy_process(&listener.name) {
        return true;
    }

    let command = listener
        .command_line
        .as_deref()
        .unwrap_or_default()
        .to_lowercase();
    if command.is_empty() {
        return false;
    }
    if DEV_COMMAND_HINTS.iter().any(|hint| command.contains(hint)) {
        return true;
    }

    command.contains(" serve") || command.contains("serve -")
}

pub fn should_include(listener: &RawListener) -> bool {
    listener.port >= DEV_PORT_MIN
        && listener.owned_by_current_user
        && is_allowed_host(&listener.host)
        && !is_protected_process_name(&listener.name)
        && looks_like_dev_server(listener)
}

pub fn project_from_cwd(cwd: &str) -> Option<String> {
    let path = Path::new(cwd);
    if path.parent().is_none() {
        return None;
    }
    if let Some(home) = std::env::var_os("HOME") {
        if path == Path::new(&home) {
            return None;
        }
    }
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
}

pub fn current_uid() -> u32 {
    nix::unistd::getuid().as_raw()
}

fn process_refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing()
        .with_cmd(UpdateKind::OnlyIfNotSet)
        .with_exe(UpdateKind::OnlyIfNotSet)
        .with_cwd(UpdateKind::OnlyIfNotSet)
        .with_user(UpdateKind::OnlyIfNotSet)
}

/// Loads process details for `pids`. Returns `(name, path, command_line, cwd, owner uid)`.
pub fn process_details(
    system: &mut System,
    pids: &[u32],
) -> BTreeMap<
    u32,
    (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<u32>,
    ),
> {
    let sys_pids: Vec<Pid> = pids.iter().map(|pid| Pid::from_u32(*pid)).collect();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&sys_pids),
        true,
        process_refresh_kind(),
    );

    pids.iter()
        .filter_map(|pid| {
            let process = system.process(Pid::from_u32(*pid))?;
            let name =
                Some(process.name().to_string_lossy().into_owned()).filter(|n| !n.is_empty());
            let path = process.exe().map(|p| p.to_string_lossy().into_owned());
            let cmd = process
                .cmd()
                .iter()
                .map(|arg| arg.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" ");
            let command_line = Some(cmd).filter(|c| !c.is_empty());
            let cwd = process
                .cwd()
                .map(|p| p.to_string_lossy().into_owned())
                .filter(|c| !c.is_empty());
            let uid = process.user_id().map(|uid| **uid);
            Some((*pid, (name, path, command_line, cwd, uid)))
        })
        .collect()
}

fn collect_raw_listeners(system: &mut System) -> Result<Vec<RawListener>, String> {
    let all = listeners::get_all().map_err(|error| format!("Failed to list sockets: {error}"))?;

    let mut seen = HashSet::new();
    let sockets: Vec<_> = all
        .into_iter()
        .filter(|l| l.protocol == Protocol::TCP && l.state == SocketState::Listen)
        .filter(|l| {
            seen.insert((
                l.process.pid,
                l.socket.port(),
                normalize_host(&l.socket.ip().to_string()),
            ))
        })
        .collect();

    let mut pids: Vec<u32> = sockets.iter().map(|l| l.process.pid).collect();
    pids.sort_unstable();
    pids.dedup();

    let details = process_details(system, &pids);
    let uid = current_uid();

    Ok(sockets
        .into_iter()
        .map(|l| {
            let (name, path, command_line, cwd, owner) =
                details.get(&l.process.pid).cloned().unwrap_or_default();
            let fallback_path = Some(l.process.path.clone()).filter(|p| !p.is_empty());
            RawListener {
                pid: l.process.pid,
                port: l.socket.port(),
                host: normalize_host(&l.socket.ip().to_string()),
                name: name.unwrap_or_else(|| l.process.name.clone()),
                path: path.or(fallback_path),
                command_line,
                cwd,
                owned_by_current_user: owner == Some(uid),
            }
        })
        .collect())
}

/// Collapses IPv4 + IPv6 listeners on the same pid/port into one row, preferring the IPv4 host.
fn dedupe_dual_stack(listeners: Vec<RawListener>) -> Vec<RawListener> {
    let mut by_key: BTreeMap<(u16, u32), RawListener> = BTreeMap::new();
    for listener in listeners {
        let key = (listener.port, listener.pid);
        match by_key.get(&key) {
            Some(existing) if !existing.host.contains(':') => {}
            _ => {
                by_key.insert(key, listener);
            }
        }
    }
    by_key.into_values().collect()
}

pub fn detect_servers(system: &mut System, self_pid: u32) -> Result<Vec<ServerInfo>, String> {
    let listeners: Vec<RawListener> = collect_raw_listeners(system)?
        .into_iter()
        .filter(|l| l.pid == self_pid || should_include(l))
        .collect();
    let listeners = dedupe_dual_stack(listeners);

    let mut ports_by_pid: BTreeMap<u32, Vec<u16>> = BTreeMap::new();
    for listener in &listeners {
        ports_by_pid
            .entry(listener.pid)
            .or_default()
            .push(listener.port);
    }

    // `dedupe_dual_stack` returns rows sorted by (port, pid).
    Ok(listeners
        .into_iter()
        .map(|l| {
            let mut sibling_ports: Vec<u16> = ports_by_pid[&l.pid]
                .iter()
                .copied()
                .filter(|p| *p != l.port)
                .collect();
            sibling_ports.sort_unstable();
            sibling_ports.dedup();
            let project = l.cwd.as_deref().and_then(project_from_cwd);
            ServerInfo {
                is_self: l.pid == self_pid,
                is_proxy: is_proxy_process(&l.name),
                pid: l.pid,
                port: l.port,
                host: l.host,
                name: l.name,
                path: l.path,
                command_line: l.command_line,
                sibling_ports,
                cwd: l.cwd,
                project,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listener(name: &str, port: u16, host: &str, command: Option<&str>) -> RawListener {
        RawListener {
            pid: 1234,
            port,
            host: host.into(),
            name: name.into(),
            path: None,
            command_line: command.map(Into::into),
            cwd: None,
            owned_by_current_user: true,
        }
    }

    #[test]
    fn normalizes_hosts() {
        assert_eq!(normalize_host("[::]"), "::");
        assert_eq!(normalize_host("::ffff:127.0.0.1"), "127.0.0.1");
        assert_eq!(normalize_host("0.0.0.0"), "0.0.0.0");
        assert_eq!(normalize_host("[::1]"), "::1");
    }

    #[test]
    fn allows_only_local_and_wildcard_hosts() {
        assert!(is_allowed_host("127.0.0.1"));
        assert!(is_allowed_host("::"));
        assert!(is_allowed_host("[::1]"));
        assert!(!is_allowed_host("192.168.1.10"));
    }

    #[test]
    fn recognizes_dev_servers_by_name_and_command() {
        assert!(looks_like_dev_server(&listener("node", 5173, "::1", None)));
        assert!(looks_like_dev_server(&listener(
            "python3.12",
            8000,
            "0.0.0.0",
            None
        )));
        assert!(looks_like_dev_server(&listener(
            "Python",
            8000,
            "0.0.0.0",
            Some("python -m http.server")
        )));
        assert!(looks_like_dev_server(&listener(
            "my-binary",
            8080,
            "127.0.0.1",
            Some("./my-binary serve --port 8080")
        )));
        assert!(!looks_like_dev_server(&listener(
            "Spotify",
            57621,
            "0.0.0.0",
            Some("/Applications/Spotify.app")
        )));
    }

    #[test]
    fn filters_out_privileged_ports_foreign_users_and_protected_processes() {
        assert!(should_include(&listener("node", 3000, "127.0.0.1", None)));
        assert!(!should_include(&listener("node", 80, "127.0.0.1", None)));
        assert!(!should_include(&listener(
            "ControlCenter",
            7000,
            "0.0.0.0",
            Some("serve")
        )));

        let mut foreign = listener("node", 3000, "127.0.0.1", None);
        foreign.owned_by_current_user = false;
        assert!(!should_include(&foreign));
    }

    #[test]
    fn derives_project_from_cwd() {
        assert_eq!(
            project_from_cwd("/Users/me/code/my-app").as_deref(),
            Some("my-app")
        );
        assert_eq!(project_from_cwd("/"), None);
    }

    #[test]
    fn collapses_dual_stack_listeners() {
        let rows = dedupe_dual_stack(vec![
            listener("node", 3000, "::", None),
            listener("node", 3000, "0.0.0.0", None),
            listener("node", 3001, "::1", None),
        ]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].host, "0.0.0.0");
        assert_eq!(rows[1].port, 3001);
    }

    /// Run with `cargo test live -- --ignored --nocapture` to print what the app would show.
    #[test]
    #[ignore]
    fn live_detection() {
        let mut system = System::new();
        for server in detect_servers(&mut system, std::process::id()).expect("detection failed") {
            println!("{server:?}");
        }
    }
}
