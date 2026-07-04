import type { ServerInfo } from '@als/shared';

type ServerTableProps = {
  servers: ServerInfo[];
  onKill: (server: ServerInfo) => void;
};

function truncate(text: string | null, max = 80): string {
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function ServerTable({ servers, onKill }: ServerTableProps) {
  return (
    <div className='table-wrap'>
      <table className='server-table'>
        <thead>
          <tr>
            <th>Port</th>
            <th>Host</th>
            <th>PID</th>
            <th>Process</th>
            <th>Path / Command</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => {
            const detail = server.commandLine ?? server.path;
            return (
              <tr key={`${server.pid}-${server.port}-${server.host}`}>
                <td className='mono'>{server.port}</td>
                <td className='mono'>{server.host}</td>
                <td className='mono'>{server.pid}</td>
                <td>
                  <span className='process-name'>{server.name}</span>
                  {server.isProxy && (
                    <span className='badge badge-warn' title='Docker/WSL proxy process'>
                      Docker/WSL
                    </span>
                  )}
                  {server.isSelf && <span className='badge badge-self'>This app</span>}
                </td>
                <td className='detail' title={detail ?? undefined}>
                  {truncate(detail)}
                </td>
                <td>
                  {server.isSelf ? (
                    <span className='muted'>—</span>
                  ) : (
                    <button type='button' className='btn btn-danger' onClick={() => onKill(server)}>
                      Kill
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
