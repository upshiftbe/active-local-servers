import { useState } from 'react';
import type { ServerInfo } from '@als/shared';

type KillConfirmDialogProps = {
  server: ServerInfo;
  killing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function KillConfirmDialog({ server, killing, onConfirm, onCancel }: KillConfirmDialogProps) {
  const [proxyAcknowledged, setProxyAcknowledged] = useState(false);

  const canConfirm = !killing && (!server.isProxy || proxyAcknowledged);

  return (
    <div className='dialog-backdrop' role='presentation' onClick={onCancel}>
      <div
        className='dialog'
        role='dialog'
        aria-labelledby='kill-dialog-title'
        aria-modal='true'
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id='kill-dialog-title'>Kill process?</h2>

        <dl className='dialog-details'>
          <div>
            <dt>Port</dt>
            <dd>{server.port}</dd>
          </div>
          <div>
            <dt>PID</dt>
            <dd>{server.pid}</dd>
          </div>
          <div>
            <dt>Process</dt>
            <dd>{server.name}</dd>
          </div>
          {server.commandLine && (
            <div className='full-width'>
              <dt>Command</dt>
              <dd className='mono wrap'>{server.commandLine}</dd>
            </div>
          )}
        </dl>

        {server.siblingPorts.length > 0 && (
          <p className='warning'>
            This will also stop ports: <strong>{server.siblingPorts.join(', ')}</strong> (same PID).
          </p>
        )}

        {server.isProxy && (
          <div className='warning-box'>
            <p>
              <strong>Warning:</strong> This looks like a Docker/WSL proxy process. Killing it may affect containers or
              WSL networking broadly.
            </p>
            <label className='checkbox-label'>
              <input
                type='checkbox'
                checked={proxyAcknowledged}
                onChange={(event) => setProxyAcknowledged(event.target.checked)}
              />
              I understand this may affect Docker/WSL
            </label>
          </div>
        )}

        <p className='muted'>
          Uses <code>taskkill /F /T</code> — the process cannot shut down gracefully.
        </p>

        <div className='dialog-actions'>
          <button type='button' className='btn btn-secondary' onClick={onCancel} disabled={killing}>
            Cancel
          </button>
          <button type='button' className='btn btn-danger' onClick={onConfirm} disabled={!canConfirm}>
            {killing ? 'Killing…' : 'Kill process'}
          </button>
        </div>
      </div>
    </div>
  );
}
