import { serverOpenUrl, type ServerInfo } from '@als/shared';

type ServerRowProps = {
  server: ServerInfo;
  confirming: boolean;
  stopping: boolean;
  onOpen: (url: string) => void;
  onRequestStop: () => void;
  onConfirmStop: () => void;
  onCancelStop: () => void;
};

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ServerRow({
  server,
  confirming,
  stopping,
  onOpen,
  onRequestStop,
  onConfirmStop,
  onCancelStop,
}: ServerRowProps) {
  const url = serverOpenUrl(server);
  const title = server.project ?? server.name;
  const detail = server.commandLine ?? server.path;

  return (
    <li className={`row${confirming ? ' row-confirming' : ''}`}>
      <div className='row-main'>
        <div className='row-info'>
          <div className='row-title'>
            <span className='status-dot' aria-hidden='true' />
            <span className='project' title={server.cwd ?? undefined}>
              {title}
            </span>
            <span className='port mono'>:{server.port}</span>
            {server.isProxy && <span className='badge badge-warn'>Docker</span>}
            {server.isSelf && <span className='badge'>This app</span>}
          </div>
          <div className='row-meta' title={detail ?? undefined}>
            <span className='mono'>{server.name}</span>
            <span className='sep'>·</span>
            <span className='mono'>PID {server.pid}</span>
            {detail && (
              <>
                <span className='sep'>·</span>
                <span className='mono command'>{truncate(detail)}</span>
              </>
            )}
          </div>
          {server.siblingPorts.length > 0 && (
            <div className='chips'>
              <span className='chips-label'>also</span>
              {server.siblingPorts.map((port) => (
                <span key={port} className='chip mono'>
                  :{port}
                </span>
              ))}
            </div>
          )}
        </div>

        {!confirming && (
          <div className='row-actions'>
            <button
              type='button'
              className='btn btn-ghost'
              onClick={() => onOpen(url)}
              title={`Open ${url}`}
              aria-label={`Open ${url}`}
            >
              Open ↗
            </button>
            {!server.isSelf && (
              <button type='button' className='btn btn-danger-ghost' onClick={onRequestStop}>
                Stop
              </button>
            )}
          </div>
        )}
      </div>

      {confirming && (
        <div className='confirm'>
          <div className='confirm-text'>
            {server.isProxy ? (
              <span className='warn'>
                This is a Docker proxy. Stopping it may take down every published container port.
              </span>
            ) : (
              <span>
                Stop <strong>{server.name}</strong> (PID {server.pid})
                {server.siblingPorts.length > 0 ? ' and all its ports' : ''}?
              </span>
            )}
          </div>
          <div className='confirm-actions'>
            <button type='button' className='btn btn-ghost' onClick={onCancelStop} disabled={stopping}>
              Cancel
            </button>
            <button type='button' className='btn btn-danger' onClick={onConfirmStop} disabled={stopping}>
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
