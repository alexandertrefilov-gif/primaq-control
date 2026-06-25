type Listener = (online: boolean) => void;

class NetworkMonitor {
  private readonly listeners = new Set<Listener>();

  constructor() {
    if (typeof window === "undefined") return;
    window.addEventListener("online", () => this.emit(true));
    window.addEventListener("offline", () => this.emit(false));
  }

  /** Current network status. Defaults to true in SSR context. */
  get isOnline(): boolean {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  }

  /**
   * Subscribe to online/offline transitions.
   * Returns an unsubscribe function.
   */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(online: boolean): void {
    for (const fn of this.listeners) fn(online);
  }
}

let _monitor: NetworkMonitor | undefined;

/** Returns the lazy singleton NetworkMonitor. */
export function getNetworkMonitor(): NetworkMonitor {
  if (!_monitor) _monitor = new NetworkMonitor();
  return _monitor;
}
