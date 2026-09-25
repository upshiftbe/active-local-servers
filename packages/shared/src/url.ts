import type { ServerInfo } from './types.js';

const LOCAL_HOSTS = new Set(['0.0.0.0', '::', '[::]', '::1', '127.0.0.1']);

export function serverOpenUrl(server: Pick<ServerInfo, 'host' | 'port'>): string {
  const { host, port } = server;

  if (LOCAL_HOSTS.has(host)) {
    return `http://localhost:${port}`;
  }

  const openHost = host.includes(':') ? `[${host}]` : host;
  return `http://${openHost}:${port}`;
}
