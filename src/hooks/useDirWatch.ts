import { useEffect, useRef } from 'react';

export function useDirWatch(
  dir: string | null,
  enabled: boolean,
  onEvent: (type: 'change' | 'error') => void
): void {
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || !dir || dir.startsWith('app://') || !window.electron?.watchStart) {
      return;
    }

    let active = true;
    let watcherId: number | null = null;
    const pendingEvents: Array<{ id: number; type: 'change' | 'error' }> = [];

    const unsubscribe = window.electron.onWatchEvent?.((e) => {
      if (!active) return;
      if (watcherId !== null) {
        if (e.id === watcherId) {
          onEventRef.current(e.type);
        }
      } else {
        pendingEvents.push({ id: e.id, type: e.type });
      }
    });

    window.electron
      .watchStart(dir)
      .then((id) => {
        if (!active) {
          // Late resolution after cleanup/unmount: stop the late id immediately
          window.electron?.watchStop?.(id).catch(() => {});
          return;
        }
        watcherId = id;
        for (const evt of pendingEvents) {
          if (evt.id === id) {
            onEventRef.current(evt.type);
          }
        }
        pendingEvents.length = 0;
      })
      .catch((err) => {
        console.error('Failed to start watcher:', err);
      });

    return () => {
      active = false;
      unsubscribe?.();
      if (watcherId !== null) {
        window.electron?.watchStop?.(watcherId).catch(() => {});
      }
    };
  }, [dir, enabled]);
}
