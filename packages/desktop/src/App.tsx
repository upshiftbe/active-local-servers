import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';
import type { ServerInfo } from '@als/shared';
import { hidePopover, listServers, openServer, quitApp, stopServer } from './api';
import { ServerRow } from './components/ServerRow';

const POLL_INTERVAL_MS = 2000;

type Notice = { kind: 'info' | 'error'; text: string };

function rowKey(server: ServerInfo): string {
  return `${server.pid}-${server.port}`;
}

export function App() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [stoppingKey, setStoppingKey] = useState<string | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const intervalRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(async (fresh = false) => {
    try {
      setServers(await listServers(fresh));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const startPolling = () => {
      if (intervalRef.current !== undefined) return;
      intervalRef.current = window.setInterval(() => void refresh(true), POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      window.clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    };

    const handleShown = () => {
      void refresh(true);
      startPolling();
    };

    const handleHidden = () => {
      stopPolling();
      setConfirmKey(null);
      setNotice(null);
    };

    const handleVisibility = () => (document.hidden ? handleHidden() : handleShown());

    void refresh();
    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    // WebKit doesn't always fire visibilitychange when a tray window hides, so also follow focus.
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) =>
      focused ? handleShown() : handleHidden(),
    );

    // The backend pushes a fresh list every few seconds, so the popover is current the moment it opens.
    const unlistenServers = listen<ServerInfo[]>('servers-updated', ({ payload }) => {
      setServers(payload);
      setError(null);
      setLoading(false);
    });

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
      void unlisten.then((fn) => fn());
      void unlistenServers.then((fn) => fn());
    };
  }, [refresh]);

  useEffect(() => {
    isAutostartEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(null));
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmKey) setConfirmKey(null);
      else void hidePopover();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [confirmKey]);

  const handleOpen = async (url: string) => {
    try {
      await openServer(url);
      await hidePopover();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleStop = async (server: ServerInfo) => {
    const key = rowKey(server);
    setStoppingKey(key);
    try {
      const result = await stopServer(server.pid);
      setNotice({ kind: result.success ? 'info' : 'error', text: result.message });
      setConfirmKey(null);
      await refresh(true);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setStoppingKey(null);
    }
  };

  const toggleAutostart = async () => {
    try {
      if (autostart) await disableAutostart();
      else await enableAutostart();
      setAutostart(await isAutostartEnabled());
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const count = servers.length;

  return (
    <div className='panel'>
      <header className='header'>
        <div>
          <h1>Local servers</h1>
          <p className='subtitle'>{loading ? 'Scanning…' : count === 1 ? '1 running' : `${count} running`}</p>
        </div>
        <button type='button' className='btn btn-icon' onClick={() => void refresh(true)} title='Refresh' aria-label='Refresh'>
          ↻
        </button>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role='status'>
          <span>{notice.text}</span>
          <button type='button' className='notice-dismiss' onClick={() => setNotice(null)} aria-label='Dismiss'>
            ×
          </button>
        </div>
      )}

      {error && (
        <div className='notice notice-error' role='alert'>
          <span>{error}</span>
        </div>
      )}

      <main className='list-wrap'>
        {loading && count === 0 ? (
          <p className='empty'>Scanning for servers…</p>
        ) : count === 0 ? (
          <div className='empty'>
            <p className='empty-title'>No local servers running</p>
            <p className='empty-hint'>Dev servers you start will show up here.</p>
          </div>
        ) : (
          <ul className='list'>
            {servers.map((server) => {
              const key = rowKey(server);
              return (
                <ServerRow
                  key={key}
                  server={server}
                  confirming={confirmKey === key}
                  stopping={stoppingKey === key}
                  onOpen={(url) => void handleOpen(url)}
                  onRequestStop={() => setConfirmKey(key)}
                  onConfirmStop={() => void handleStop(server)}
                  onCancelStop={() => setConfirmKey(null)}
                />
              );
            })}
          </ul>
        )}
      </main>

      <footer className='footer'>
        <label className='toggle'>
          <input
            type='checkbox'
            checked={autostart ?? false}
            disabled={autostart === null}
            onChange={() => void toggleAutostart()}
          />
          Launch at login
        </label>
        <button type='button' className='btn btn-ghost' onClick={() => void quitApp()}>
          Quit
        </button>
      </footer>
    </div>
  );
}
