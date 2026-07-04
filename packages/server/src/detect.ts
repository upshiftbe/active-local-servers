import { execa } from 'execa';
import type { ServerInfo } from '@als/shared';
import { isProtectedProcessName, isProxyProcess } from './safety.js';

const DEV_PORT_MIN = 1024;
const DEV_PORT_MAX = 65535;

const ALLOWED_HOSTS = new Set(['127.0.0.1', '0.0.0.0', '::', '::1', '[::]']);

const DEV_PROCESS_NAMES = new Set([
  'node',
  'python',
  'python3',
  'java',
  'javaw',
  'dotnet',
  'php',
  'ruby',
  'go',
  'deno',
  'bun',
  'nginx',
  'httpd',
  'cargo',
  'rustc',
  'esbuild',
  'webpack',
  'vite',
]);

const DEV_COMMAND_HINTS = [
  'vite',
  'next',
  'webpack',
  'express',
  'fastify',
  'nuxt',
  'remix',
  'astro',
  'http-server',
  'live-server',
  'tsx',
  'ts-node',
  'nodemon',
  'start-server',
  'dev-server',
  'npm run dev',
  'pnpm dev',
  'yarn dev',
];

type RawListener = {
  pid: number;
  port: number;
  host: string;
  name: string;
  path: string | null;
  commandLine: string | null;
};

const DETECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
$listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -ge ${DEV_PORT_MIN} -and $_.LocalPort -le ${DEV_PORT_MAX} } |
  Select-Object LocalAddress, LocalPort, OwningProcess

$pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
$processes = @{}
if ($pids) {
  Get-Process -Id $pids -ErrorAction SilentlyContinue | ForEach-Object {
    $processes[$_.Id] = @{ Name = $_.ProcessName; Path = $_.Path }
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $pids -contains $_.ProcessId } |
    ForEach-Object {
      if ($processes.ContainsKey($_.ProcessId)) {
        $processes[$_.ProcessId].CommandLine = $_.CommandLine
      } else {
        $processes[$_.ProcessId] = @{ Name = $_.Name; Path = $null; CommandLine = $_.CommandLine }
      }
    }
}

$result = foreach ($l in $listeners) {
  $proc = $processes[$l.OwningProcess]
  [PSCustomObject]@{
    pid = [int]$l.OwningProcess
    port = [int]$l.LocalPort
    host = [string]$l.LocalAddress
    name = if ($proc) { [string]$proc.Name } else { 'unknown' }
    path = if ($proc -and $proc.Path) { [string]$proc.Path } else { $null }
    commandLine = if ($proc -and $proc.CommandLine) { [string]$proc.CommandLine } else { $null }
  }
}

if (-not $result) { '[]' } else { $result | ConvertTo-Json -Compress }
`.trim();

function normalizeHost(host: string): string {
  if (host === '[::]') return '::';
  return host;
}

function isAllowedHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return ALLOWED_HOSTS.has(normalized);
}

function normalizeProcessName(name: string): string {
  return name.toLowerCase().replace(/\.exe$/i, '');
}

function looksLikeDevServer(listener: RawListener): boolean {
  const name = normalizeProcessName(listener.name);

  if (name === 'unknown') return true;
  if (DEV_PROCESS_NAMES.has(name)) return true;
  if (isProxyProcess(listener.name)) return true;

  const command = (listener.commandLine ?? '').toLowerCase();
  if (command && DEV_COMMAND_HINTS.some((hint) => command.includes(hint))) {
    return true;
  }

  if (command.includes(' serve') || command.includes('serve -')) {
    return true;
  }

  return false;
}

function shouldIncludeListener(listener: RawListener): boolean {
  if (!isAllowedHost(listener.host)) return false;
  if (isProtectedProcessName(listener.name)) return false;
  return looksLikeDevServer(listener);
}

function parseListeners(stdout: string): RawListener[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as RawListener | RawListener[];
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items.filter(
    (item) => item && typeof item.pid === 'number' && typeof item.port === 'number' && shouldIncludeListener(item),
  );
}

export async function detectServers(selfPid: number, selfPort: number): Promise<ServerInfo[]> {
  const { stdout } = await execa('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DETECT_SCRIPT]);

  const listeners = parseListeners(stdout);

  const portsByPid = new Map<number, number[]>();
  for (const listener of listeners) {
    const ports = portsByPid.get(listener.pid) ?? [];
    ports.push(listener.port);
    portsByPid.set(listener.pid, ports);
  }

  const servers: ServerInfo[] = listeners.map((listener) => {
    const allPorts = portsByPid.get(listener.pid) ?? [listener.port];
    const siblingPorts = allPorts.filter((port) => port !== listener.port).sort((a, b) => a - b);

    const isSelf = listener.pid === selfPid;

    return {
      pid: listener.pid,
      port: listener.port,
      host: normalizeHost(listener.host),
      name: listener.name,
      path: listener.path,
      commandLine: listener.commandLine,
      isSelf,
      isProxy: isProxyProcess(listener.name),
      siblingPorts,
    };
  });

  servers.sort((a, b) => a.port - b.port || a.pid - b.pid);

  const hasSelf = servers.some((s) => s.isSelf);
  if (!hasSelf && selfPort > 0) {
    servers.push({
      pid: selfPid,
      port: selfPort,
      host: '127.0.0.1',
      name: 'node',
      path: null,
      commandLine: process.argv.join(' '),
      isSelf: true,
      isProxy: false,
      siblingPorts: [],
    });
    servers.sort((a, b) => a.port - b.port || a.pid - b.pid);
  }

  return servers;
}

export async function findPidByPort(port: number): Promise<number | null> {
  const servers = await detectServers(process.pid, -1);
  const match = servers.find((server) => server.port === port);
  return match?.pid ?? null;
}

export async function findProcessName(pid: number): Promise<string> {
  try {
    const { stdout } = await execa('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).ProcessName`,
    ]);
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}
