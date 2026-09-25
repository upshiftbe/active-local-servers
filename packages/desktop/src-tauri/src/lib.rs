mod detect;
mod kill;
mod safety;

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use sysinfo::System;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, Monitor, Rect, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_opener::OpenerExt;

use detect::ServerInfo;
use kill::KillResponse;
use safety::{validate_kill_target, KillGuard};

const POPOVER_LABEL: &str = "popover";
const TRAY_ID: &str = "main";
const TRAY_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const POPOVER_WIDTH: f64 = 460.0;
const POPOVER_MARGIN: f64 = 6.0;
const SCREEN_EDGE_MARGIN: f64 = 8.0;
/// Ignore focus loss this soon after showing: the tray click that opened the popover can blur it.
const SHOW_GRACE: Duration = Duration::from_millis(300);
const SERVERS_EVENT: &str = "servers-updated";

struct AppState {
    system: Mutex<System>,
    /// Last known tray icon rectangle, used to place the popover under the icon.
    tray_rect: Mutex<Option<Rect>>,
    /// When the popover was last hidden by losing focus. Clicking the tray icon
    /// blurs the popover first, so without this the click would immediately reopen it.
    last_blur_hide: Mutex<Option<Instant>>,
    last_shown: Mutex<Option<Instant>>,
}

fn self_pid() -> u32 {
    std::process::id()
}

#[tauri::command]
async fn list_servers(app: AppHandle) -> Result<Vec<ServerInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut system = state.system.lock().map_err(|_| "Process table is unavailable.".to_string())?;
        let servers = detect::detect_servers(&mut system, self_pid())?;
        drop(system);
        update_tray_count(&app, servers.len());
        Ok(servers)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn stop_server(app: AppHandle, pid: u32) -> Result<KillResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (name, owner) = {
            let state = app.state::<AppState>();
            let mut system = state.system.lock().map_err(|_| "Process table is unavailable.".to_string())?;
            let details = detect::process_details(&mut system, &[pid]);
            match details.get(&pid) {
                Some((name, _, _, _, owner)) => (name.clone().unwrap_or_else(|| "unknown".into()), *owner),
                None => return Ok(KillResponse::err(format!("Process PID {pid} is no longer running."))),
            }
        };

        let owned = owner == Some(detect::current_uid());
        if let KillGuard::Denied(reason) = validate_kill_target(pid, &name, self_pid(), owned) {
            return Ok(KillResponse::err(reason));
        }

        Ok(kill::stop_process(pid, &name))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn open_server(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) URLs can be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_popover(app: AppHandle) {
    if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
        let _ = window.hide();
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn update_tray_count(app: &AppHandle, count: usize) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let tooltip = match count {
        1 => "1 local server".to_string(),
        n => format!("{n} local servers"),
    };
    let _ = tray.set_tooltip(Some(tooltip));
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(if count > 0 { Some(count.to_string()) } else { None });
}

fn spawn_tray_refresher(app: AppHandle) {
    thread::spawn(move || {
        // Separate from the shared `System` so a slow scan never blocks the popover.
        let mut system = System::new();
        loop {
            if let Ok(servers) = detect::detect_servers(&mut system, self_pid()) {
                update_tray_count(&app, servers.len());
                // Keeps the (hidden) popover's list current, so it's ready the moment it opens.
                let _ = app.emit_to(POPOVER_LABEL, SERVERS_EVENT, &servers);
            }
            thread::sleep(TRAY_REFRESH_INTERVAL);
        }
    });
}

/// Monitor containing the tray icon. Tray and monitor positions are both physical pixels
/// scaled by that monitor's own scale factor, so a direct comparison works per monitor.
fn tray_monitor(window: &WebviewWindow, rect: &Rect) -> Option<(Monitor, f64, f64)> {
    let monitors = window.available_monitors().ok()?;
    monitors.into_iter().find_map(|monitor| {
        let scale = monitor.scale_factor();
        let x = rect.position.to_physical::<f64>(scale).x;
        let y = rect.position.to_physical::<f64>(scale).y;
        let pos = monitor.position();
        let size = monitor.size();
        let inside = x >= pos.x as f64
            && x < pos.x as f64 + size.width as f64
            && y >= pos.y as f64
            && y < pos.y as f64 + size.height as f64;
        inside.then_some((monitor, x, y))
    })
}

fn position_popover(app: &AppHandle, window: &WebviewWindow) {
    let tray_rect = *app.state::<AppState>().tray_rect.lock().unwrap();

    // Work in logical points on the target monitor so mixed-DPI setups (Retina + external) line up.
    let placement = tray_rect.and_then(|rect| {
        let (monitor, x, y) = tray_monitor(window, &rect)?;
        let scale = monitor.scale_factor();
        let tray_size = rect.size.to_physical::<f64>(scale);
        let center_x = (x + tray_size.width / 2.0) / scale;
        let bottom_y = (y + tray_size.height) / scale;
        Some((monitor, center_x - POPOVER_WIDTH / 2.0, bottom_y + POPOVER_MARGIN))
    });

    let (monitor, x, y) = match placement {
        Some(placement) => placement,
        // No tray rect (e.g. Linux AppIndicator): top-right corner of the primary monitor.
        None => {
            let Some(monitor) = window.primary_monitor().ok().flatten() else { return };
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            let right = (area.position.x as f64 + area.size.width as f64) / scale;
            let top = area.position.y as f64 / scale;
            (monitor, right - POPOVER_WIDTH - 12.0, top + 12.0)
        }
    };

    // Keep the popover fully on the tray's monitor when the icon sits near the right edge.
    let scale = monitor.scale_factor();
    let min_x = monitor.position().x as f64 / scale + SCREEN_EDGE_MARGIN;
    let max_x = (monitor.position().x as f64 + monitor.size().width as f64) / scale - POPOVER_WIDTH - SCREEN_EDGE_MARGIN;
    let x = x.clamp(min_x, max_x.max(min_x));

    let _ = window.set_position(LogicalPosition::new(x, y));
}

fn show_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window(POPOVER_LABEL) else { return };
    position_popover(app, &window);
    *app.state::<AppState>().last_shown.lock().unwrap() = Some(Instant::now());
    let _ = window.show();
    let _ = window.set_focus();
    // Position again once shown: macOS can only move a window to another display reliably when visible.
    position_popover(app, &window);
}

fn toggle_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window(POPOVER_LABEL) else { return };

    let recently_blurred = app
        .state::<AppState>()
        .last_blur_hide
        .lock()
        .unwrap()
        .is_some_and(|at| at.elapsed() < Duration::from_millis(300));

    if window.is_visible().unwrap_or(false) || recently_blurred {
        let _ = window.hide();
    } else {
        show_popover(app);
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let show = MenuItem::with_id(app, "show", "Show servers", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Active Local Servers", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&show, &separator, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Active Local Servers")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_popover(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            if let TrayIconEvent::Click { rect, .. } | TrayIconEvent::Enter { rect, .. } = &event {
                *app.state::<AppState>().tray_rect.lock().unwrap() = Some(*rect);
            }
            // Open on mouse-down so the list appears the instant the icon is pressed.
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Down, .. } = event {
                toggle_popover(app);
            }
        })
        .build(app)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_popover(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(AppState {
            system: Mutex::new(System::new()),
            tray_rect: Mutex::new(None),
            last_blur_hide: Mutex::new(None),
            last_shown: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![list_servers, stop_server, open_server, hide_popover, quit])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_tray(app.handle())?;
            spawn_tray_refresher(app.handle().clone());

            if let Some(window) = app.get_webview_window(POPOVER_LABEL) {
                let handle = app.handle().clone();
                let popover = window.clone();
                window.on_window_event(move |event| match event {
                    WindowEvent::Focused(false) => {
                        let state = handle.state::<AppState>();
                        let just_shown = state.last_shown.lock().unwrap().is_some_and(|at| at.elapsed() < SHOW_GRACE);
                        if popover.is_visible().unwrap_or(false) && !just_shown {
                            *state.last_blur_hide.lock().unwrap() = Some(Instant::now());
                            let _ = popover.hide();
                        }
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = popover.hide();
                    }
                    _ => {}
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Active Local Servers")
        .run(|_app, event| {
            // Closing the popover must not quit a tray app.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
