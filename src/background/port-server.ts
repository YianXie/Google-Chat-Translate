import type { LanguageCode } from '../shared/languages';
import {
  EngineError,
  type ClientMessage,
  type EngineEvent,
  type EngineRequest,
  type StatusResult,
  type TranslateResult,
} from '../shared/protocol';
import type { Engine } from './engine';

type OnProgress = (loaded: number | null, source?: LanguageCode, target?: LanguageCode) => void;

function handle(engine: Engine, message: EngineRequest, onProgress: OnProgress): Promise<TranslateResult | StatusResult | null> {
  switch (message.type) {
    case 'translate':
      return engine.translate(message, onProgress);
    case 'status':
      return engine.status(message.target);
    case 'download':
      return engine.download(message.source, message.target, onProgress).then(() => null);
    case 'download-detector':
      return engine.downloadDetector((loaded) => onProgress(loaded)).then(() => null);
  }
}

/** Answers the request a content script or the popup sends on its port. */
export function servePort(port: chrome.runtime.Port, engine: Engine): void {
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    void chrome.runtime.lastError;
  });
  const post = (event: EngineEvent) => {
    if (!connected) return;
    try {
      port.postMessage(event);
    } catch {
      connected = false;
    }
  };

  port.onMessage.addListener(async (message: ClientMessage) => {
    if (message.type === 'ping') return;
    try {
      const result = await handle(engine, message, (loaded, source, target) =>
        post({ type: 'progress', loaded, source, target }),
      );
      post({ type: 'done', result });
    } catch (error) {
      post(
        error instanceof EngineError
          ? { type: 'error', code: error.code, source: error.source, target: error.target }
          : { type: 'error', code: 'translate-failed' },
      );
    }
  });
}
