import type { KillRequest, KillResponse, ServersResponse } from '@als/shared';

async function handleResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error((data as { message?: string }).message ?? `Request failed (${response.status})`);
  }
  return data;
}

export async function fetchServers(): Promise<ServersResponse> {
  const response = await fetch('/api/servers');
  return handleResponse<ServersResponse>(response);
}

export async function killServer(body: KillRequest): Promise<KillResponse> {
  const response = await fetch('/api/kill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<KillResponse>(response);
}
