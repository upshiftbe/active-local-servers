import { execa } from 'execa';
import { findPidByPort, findProcessName } from './detect.js';
import { validateKillTarget } from './safety.js';

export type KillResult = {
  success: boolean;
  message: string;
  statusCode?: number;
};

export async function killByPid(pid: number, selfPid: number, processName?: string): Promise<KillResult> {
  const name = processName ?? (await findProcessName(pid));
  const guard = validateKillTarget(pid, name, selfPid);

  if (!guard.allowed) {
    return {
      success: false,
      message: guard.reason,
      statusCode: guard.statusCode,
    };
  }

  try {
    await execa('taskkill', ['/PID', String(pid), '/T', '/F']);
    return {
      success: true,
      message: `Killed process ${name} (PID ${pid}).`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to kill process.';
    const isNotFound =
      message.toLowerCase().includes('not found') || message.toLowerCase().includes('no running instance');

    return {
      success: false,
      message: isNotFound ? `Process PID ${pid} is no longer running.` : message,
      statusCode: isNotFound ? 404 : 500,
    };
  }
}

export async function killByPort(port: number, selfPid: number): Promise<KillResult> {
  const pid = await findPidByPort(port);

  if (pid === null) {
    return {
      success: false,
      message: `No listener found on port ${port}.`,
      statusCode: 404,
    };
  }

  return killByPid(pid, selfPid);
}
