import { vi } from 'vitest';

type Listener<A extends unknown[]> = (...args: A) => void;

export class FakeEvent<A extends unknown[]> {
  readonly listeners = new Set<Listener<A>>();

  addListener(listener: Listener<A>): void {
    this.listeners.add(listener);
  }

  removeListener(listener: Listener<A>): void {
    this.listeners.delete(listener);
  }

  hasListeners(): boolean {
    return this.listeners.size > 0;
  }

  dispatch(...args: A): void {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

/** One end of a runtime port. Messages are JSON-copied and delivered asynchronously, as in Chrome. */
export class FakePort {
  readonly name: string;
  readonly onMessage = new FakeEvent<[unknown, FakePort]>();
  readonly onDisconnect = new FakeEvent<[FakePort]>();
  readonly sent: unknown[] = [];
  peer!: FakePort;
  connected = true;

  constructor(name: string) {
    this.name = name;
  }

  postMessage(message: unknown): void {
    if (!this.connected) throw new Error('Attempting to use a disconnected port object');
    const copy: unknown = JSON.parse(JSON.stringify(message));
    this.sent.push(copy);
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer.connected) peer.onMessage.dispatch(copy, peer);
    });
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    const peer = this.peer;
    queueMicrotask(() => {
      if (!peer.connected) return;
      peer.connected = false;
      peer.onDisconnect.dispatch(peer);
    });
  }
}

export interface DetectLanguageResult {
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}

export function installFakeChrome(options: { uiLanguage?: string } = {}) {
  const syncData: Record<string, unknown> = {};
  const onChanged = new FakeEvent<[Record<string, { oldValue?: unknown; newValue?: unknown }>, string]>();
  const onConnect = new FakeEvent<[FakePort]>();
  let contextValid = true;

  const fake = {
    storage: {
      onChanged,
      sync: {
        async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
          const wanted = keys == null ? Object.keys(syncData) : typeof keys === 'string' ? [keys] : keys;
          const result: Record<string, unknown> = {};
          for (const key of wanted) if (key in syncData) result[key] = structuredClone(syncData[key]);
          return result;
        },
        async set(items: Record<string, unknown>): Promise<void> {
          const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: syncData[key], newValue: structuredClone(value) };
            syncData[key] = structuredClone(value);
          }
          queueMicrotask(() => onChanged.dispatch(changes, 'sync'));
        },
      },
    },
    i18n: {
      getUILanguage: () => options.uiLanguage ?? 'en-US',
      detectLanguage: vi.fn(async (_text: string): Promise<DetectLanguageResult> => ({ isReliable: false, languages: [] })),
    },
    runtime: {
      lastError: undefined as { message: string } | undefined,
      onConnect,
      connect(info: { name?: string } = {}): FakePort {
        if (!contextValid) throw new Error('Extension context invalidated.');
        const client = new FakePort(info.name ?? '');
        const server = new FakePort(info.name ?? '');
        client.peer = server;
        server.peer = client;
        queueMicrotask(() => {
          if (onConnect.hasListeners()) onConnect.dispatch(server);
          else server.disconnect();
        });
        return client;
      },
    },
  };

  vi.stubGlobal('chrome', fake);
  return {
    chrome: fake,
    syncData,
    invalidateContext(): void {
      contextValid = false;
    },
  };
}

/** Lets queued microtasks and zero-delay timers run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
