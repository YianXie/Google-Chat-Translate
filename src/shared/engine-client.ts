import {
  EngineError,
  KEEPALIVE_MS,
  PORT_NAME,
  type ClientMessage,
  type DownloadProgress,
  type EngineEvent,
  type EngineRequest,
  type ResultFor,
} from './protocol';

export interface RequestOptions {
  onProgress?: (progress: DownloadProgress) => void;
  keepAliveMs?: number;
}

/** Sends one request to the translation engine in the service worker. */
export function request<R extends EngineRequest>(message: R, options: RequestOptions = {}): Promise<ResultFor<R>> {
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      reject(new EngineError('engine-unreachable'));
      return;
    }

    let settled = false;
    const send = (outgoing: ClientMessage) => {
      try {
        port.postMessage(outgoing);
      } catch {
        // The port is already gone; onDisconnect reports it.
      }
    };
    const keepAlive = setInterval(() => send({ type: 'ping' }), options.keepAliveMs ?? KEEPALIVE_MS);
    const settle = () => {
      if (settled) return false;
      settled = true;
      clearInterval(keepAlive);
      return true;
    };

    port.onMessage.addListener((event: EngineEvent) => {
      if (event.type === 'progress') {
        if (!settled) options.onProgress?.(event);
        return;
      }
      if (!settle()) return;
      port.disconnect();
      if (event.type === 'done') resolve(event.result as ResultFor<R>);
      else reject(new EngineError(event.code, event.source, event.target));
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (settle()) reject(new EngineError('engine-unreachable'));
    });
    send(message);
  });
}
