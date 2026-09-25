// Lets `pnpm -F @als/desktop dev` render the popover in a plain browser, outside Tauri.
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type { ServerInfo } from '@als/shared';

let servers: ServerInfo[] = [
  {
    pid: 4812,
    port: 3000,
    host: '::',
    name: 'node',
    path: '/usr/local/bin/node',
    commandLine: 'node /Users/me/code/storefront/node_modules/.bin/next dev',
    isSelf: false,
    isProxy: false,
    siblingPorts: [],
    cwd: '/Users/me/code/storefront',
    project: 'storefront',
  },
  {
    pid: 5120,
    port: 5173,
    host: '::1',
    name: 'node',
    path: '/usr/local/bin/node',
    commandLine: 'node /Users/me/code/dashboard/node_modules/.bin/vite',
    isSelf: false,
    isProxy: false,
    siblingPorts: [24678],
    cwd: '/Users/me/code/dashboard',
    project: 'dashboard',
  },
  {
    pid: 6001,
    port: 8000,
    host: '127.0.0.1',
    name: 'python3.12',
    path: '/opt/homebrew/bin/python3.12',
    commandLine: 'python manage.py runserver',
    isSelf: false,
    isProxy: false,
    siblingPorts: [],
    cwd: '/Users/me/code/api-service-with-a-rather-long-project-name',
    project: 'api-service-with-a-rather-long-project-name',
  },
  {
    pid: 912,
    port: 5432,
    host: '0.0.0.0',
    name: 'com.docker.backend',
    path: null,
    commandLine: null,
    isSelf: false,
    isProxy: true,
    siblingPorts: [6379],
    cwd: null,
    project: null,
  },
];

let autostart = false;

mockWindows('popover');
mockIPC((cmd, args) => {
  const payload = args as Record<string, unknown> | undefined;
  switch (cmd) {
    case 'list_servers':
      return servers;
    case 'stop_server': {
      const pid = payload?.pid as number;
      const target = servers.find((server) => server.pid === pid);
      servers = servers.filter((server) => server.pid !== pid);
      return { success: true, message: `Stopped ${target?.name ?? 'process'} (PID ${pid}).` };
    }
    case 'open_server':
      window.open(payload?.url as string, '_blank');
      return null;
    case 'plugin:autostart|is_enabled':
      return autostart;
    case 'plugin:autostart|enable':
      autostart = true;
      return null;
    case 'plugin:autostart|disable':
      autostart = false;
      return null;
    default:
      return null;
  }
}, { shouldMockEvents: true });
