import { invoke } from '@tauri-apps/api/core';
import type { KillResponse, ServerInfo } from '@als/shared';

export function listServers(fresh = false): Promise<ServerInfo[]> {
  return invoke<ServerInfo[]>('list_servers', { fresh });
}

export function stopServer(pid: number): Promise<KillResponse> {
  return invoke<KillResponse>('stop_server', { pid });
}

export function openServer(url: string): Promise<void> {
  return invoke('open_server', { url });
}

export function hidePopover(): Promise<void> {
  return invoke('hide_popover');
}

export function quitApp(): Promise<void> {
  return invoke('quit');
}
