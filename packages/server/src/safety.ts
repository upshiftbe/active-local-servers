const PROTECTED_PROCESS_NAMES = new Set([
  'system',
  'csrss',
  'lsass',
  'services',
  'smss',
  'wininit',
  'winlogon',
  'svchost',
  'dwm',
  'explorer',
]);

export const PROXY_PROCESS_NAMES = new Set([
  'com.docker.backend',
  'docker',
  'docker-proxy',
  'wslrelay',
  'wslservice',
  'vmcompute',
  'vmwp',
]);

export function isProtectedPid(pid: number): boolean {
  return pid <= 4;
}

export function isProtectedProcessName(name: string): boolean {
  return PROTECTED_PROCESS_NAMES.has(name.toLowerCase());
}

export function isProxyProcess(name: string): boolean {
  const lower = name.toLowerCase();
  return PROXY_PROCESS_NAMES.has(lower) || lower.includes('docker') || lower.includes('wsl');
}

export type KillGuardResult = { allowed: true } | { allowed: false; reason: string; statusCode: 400 | 403 };

export function validateKillTarget(pid: number, processName: string, selfPid: number): KillGuardResult {
  if (pid === selfPid) {
    return {
      allowed: false,
      reason: 'Cannot kill the dashboard process itself.',
      statusCode: 403,
    };
  }

  if (isProtectedPid(pid)) {
    return {
      allowed: false,
      reason: `PID ${pid} is a protected system process.`,
      statusCode: 403,
    };
  }

  if (isProtectedProcessName(processName)) {
    return {
      allowed: false,
      reason: `Process "${processName}" is protected and cannot be killed.`,
      statusCode: 403,
    };
  }

  return { allowed: true };
}
