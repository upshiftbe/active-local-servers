# Active Local Servers

Lists active dev servers (listening TCP ports) and lets you open or stop them.

- **Desktop app (macOS / Linux):** a menubar/tray app, see [Desktop app](#desktop-app-macos--linux).
- **Web dashboard (Windows):** a local web dashboard, described below.

## Prerequisites

- **Node.js 20+**
- **Windows 10/11** (uses PowerShell `Get-NetTCPConnection`)

## Quick start (development)

```bash
pnpm install
pnpm dev
```

Open **http://localhost:5173** in your browser. The Vite dev server proxies API requests to the backend on port 4711.

## Production-style (single port)

```bash
pnpm install
pnpm build
pnpm start
```

Open **http://127.0.0.1:4711** — the API and built UI are served together.

## What it shows

- Listening TCP ports in the range 1024–65535 on loopback/all-interfaces addresses
- Process name, path, and command line (when available)
- One row per port; multiple ports on the same PID are listed separately

## Kill behavior

- Killing a server terminates the **entire process** (`taskkill /PID <pid> /T /F`), including all ports that PID owns.
- The dashboard’s own process appears in the list with **This app** — Kill is disabled.
- Docker/WSL proxy processes show a warning and require an extra confirmation step.
- Protected system processes cannot be killed.

## Safety

- The API binds to **127.0.0.1 only** — not accessible from other machines on your network.
- Kill is forceful (`/F`); there is no graceful shutdown.
- Some processes may require elevated permissions to kill; errors are shown in the UI.

## Environment

| Variable | Default | Description                         |
| -------- | ------- | ----------------------------------- |
| `PORT`   | `4711`  | API (and production UI) listen port |

## Desktop app (macOS / Linux)

A menubar (tray) app built with Tauri 2. Click the icon to see your running local servers, grouped by project folder, each with **Open** and **Stop**. On macOS the number of running servers is shown next to the icon.

### Develop

Requires Node.js 20+, pnpm and a [Rust toolchain](https://rustup.rs).

```bash
pnpm install
pnpm desktop:dev
```

To iterate on the popover UI in a browser with mock data, run `pnpm -F @als/desktop dev` and open http://localhost:1420.

Rust unit tests (filters, safety guard, stop behavior):

```bash
cd packages/desktop/src-tauri && cargo test
```

### Build

```bash
pnpm desktop:build
```

- **macOS:** produces `Active Local Servers.app` and a `.dmg` in `packages/desktop/src-tauri/target/release/bundle/`. The build is not code-signed, so the first time you open it, right-click the app → **Open**.
- **Linux:** produces a `.deb` and an `.AppImage`. You have to build on Linux (or use the `Desktop app` GitHub Actions workflow, which builds both platforms). Build dependencies on Debian/Ubuntu:

  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
  ```

### Behavior

- Shows listening TCP ports ≥ 1024 on loopback/wildcard addresses, owned by **your user**, that look like dev servers (node, python, ruby, bun, deno, vite, next, uvicorn, …). System services such as ControlCenter/AirPlay are hidden.
- **Stop** sends `SIGTERM`, waits up to 3 seconds, then sends `SIGKILL` if the process is still running. It stops the whole process, including all its ports.
- **Launch at login** can be toggled in the popover footer.
- **Linux:** most desktops (AppIndicator) don't report tray clicks, so open the popover via the tray menu → **Show servers**. On GNOME you need the [AppIndicator extension](https://extensions.gnome.org/extension/615/appindicator-support/) for tray icons to appear.

## Project structure

```
packages/
  shared/   Shared TypeScript types
  server/   Fastify API + Windows detection/kill
  web/      React + Vite dashboard (Windows)
  desktop/  Tauri 2 menubar app (macOS/Linux): React popover + Rust backend in src-tauri/
```
