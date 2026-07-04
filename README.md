# Active Local Servers

A local web dashboard for Windows that lists active dev servers (listening TCP ports) and lets you kill them safely.

## Prerequisites

- **Node.js 20+**
- **Windows 10/11** (uses PowerShell `Get-NetTCPConnection`)

## Quick start (development)

```bash
npm install
npm run dev
```

Open **http://localhost:5173** in your browser. The Vite dev server proxies API requests to the backend on port 4711.

## Production-style (single port)

```bash
npm install
npm run build
npm start
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

## Project structure

```
packages/
  shared/   Shared TypeScript types
  server/   Fastify API + Windows detection/kill
  web/      React + Vite dashboard
```
