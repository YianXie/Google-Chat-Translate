import type { Availability } from './built-in-ai';
import type { LanguageCode } from './languages';
import type { SourceSetting } from './settings';

/** Content scripts and the popup open one port with this name per request to the service worker. */
export const PORT_NAME = 'gct-engine';

/** How often a waiting client pings, so Chrome keeps the service worker alive through long downloads. */
export const KEEPALIVE_MS = 15_000;

export type EngineRequest =
  | { type: 'translate'; text: string; source: SourceSetting; target: LanguageCode }
  | { type: 'status'; target: LanguageCode }
  | { type: 'download'; source: LanguageCode; target: LanguageCode }
  | { type: 'download-detector' };

export type ClientMessage = EngineRequest | { type: 'ping' };

export type TranslateResult =
  | { kind: 'translated'; text: string; source: LanguageCode; target: LanguageCode }
  | { kind: 'same-language'; source: LanguageCode; target: LanguageCode };

export interface StatusResult {
  /** False when this Chrome has no on-device Translator (too old, not desktop, or disabled by policy). */
  supported: boolean;
  detector: Availability;
  /** Source languages that already translate into the target without a download. */
  ready: LanguageCode[];
}

export type ResultFor<R extends EngineRequest> = R extends { type: 'translate' }
  ? TranslateResult
  : R extends { type: 'status' }
    ? StatusResult
    : null;

export type EngineErrorCode =
  | 'api-unavailable'
  | 'detect-failed'
  | 'unsupported-pair'
  | 'download-failed'
  | 'translate-failed'
  | 'engine-unreachable';

export interface DownloadProgress {
  type: 'progress';
  /** 0 to 1, or null while Chrome downloads something it reports no progress for. */
  loaded: number | null;
  source?: LanguageCode;
  target?: LanguageCode;
}

export type EngineEvent =
  | DownloadProgress
  | { type: 'done'; result: TranslateResult | StatusResult | null }
  | { type: 'error'; code: EngineErrorCode; source?: LanguageCode; target?: LanguageCode };

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly source: LanguageCode | undefined;
  readonly target: LanguageCode | undefined;

  constructor(code: EngineErrorCode, source?: LanguageCode, target?: LanguageCode) {
    super(code);
    this.name = 'EngineError';
    this.code = code;
    this.source = source;
    this.target = target;
  }
}
