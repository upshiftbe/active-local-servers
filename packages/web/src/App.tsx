import { useCallback, useEffect, useState } from 'react';
import type { ServerInfo } from '@als/shared';
import { fetchServers, killServer } from './api';
import { KillConfirmDialog } from './components/KillConfirmDialog';
import { ServerTable } from './components/ServerTable';

const POLL_INTERVAL_MS = 3000;

export function App() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [killTarget, setKillTarget] = useState<ServerInfo | null>(null);
  const [killMessage, setKillMessage] = useState<string | null>(null);
  const [killing, setKilling] = useState(false);

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const data = await fetchServers();
      setServers(data.servers);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    let intervalId: number | undefined;

    const startPolling = () => {
      intervalId = window.setInterval(() => {
        void refresh(false);
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        void refresh(false);
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  const handleKillConfirm = async () => {
    if (!killTarget) return;

    setKilling(true);
    setKillMessage(null);

    try {
      const result = await killServer({ pid: killTarget.pid });
      setKillMessage(result.message);
      setKillTarget(null);
      await refresh(false);
    } catch (err) {
      setKillMessage(err instanceof Error ? err.message : 'Failed to kill process.');
    } finally {
      setKilling(false);
    }
  };

  return (
    <div className='app'>
      <header className='header'>
        <div>
          <h1>Active Local Servers</h1>
          <p className='subtitle'>Local dev listeners on your machine. Kill terminates the whole process.</p>
        </div>
        <div className='header-actions'>
          {lastRefreshed && <span className='timestamp'>Last refreshed: {lastRefreshed.toLocaleTimeString()}</span>}
          <button type='button' className='btn btn-secondary' onClick={() => void refresh(true)} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {killMessage && (
        <div className='banner banner-info' role='status'>
          {killMessage}
          <button type='button' className='banner-dismiss' onClick={() => setKillMessage(null)} aria-label='Dismiss'>
            ×
          </button>
        </div>
      )}

      {error && (
        <div className='banner banner-error' role='alert'>
          {error}
        </div>
      )}

      <main>
        {loading && servers.length === 0 ? (
          <p className='empty'>Loading servers…</p>
        ) : servers.length === 0 ? (
          <p className='empty'>No active dev servers found.</p>
        ) : (
          <ServerTable servers={servers} onKill={setKillTarget} />
        )}
      </main>

      {killTarget && (
        <KillConfirmDialog
          server={killTarget}
          killing={killing}
          onConfirm={() => void handleKillConfirm()}
          onCancel={() => setKillTarget(null)}
        />
      )}
    </div>
  );
}
