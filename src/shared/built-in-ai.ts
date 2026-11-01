// Chrome's on-device Translator and LanguageDetector APIs (Chrome 138+), typed
// only as far as this extension uses them. The real objects are globals.

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

export interface CreateOptions {
  monitor?: (monitor: DownloadMonitor) => void;
  signal?: AbortSignal;
}

export interface LanguagePair {
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslatorInstance {
  translate(input: string): Promise<string>;
  destroy(): void;
}

export interface TranslatorApi {
  availability(pair: LanguagePair): Promise<Availability>;
  create(options: LanguagePair & CreateOptions): Promise<TranslatorInstance>;
}

export interface DetectionCandidate {
  detectedLanguage: string;
  confidence: number;
}

export interface LanguageDetectorInstance {
  detect(input: string): Promise<DetectionCandidate[]>;
  destroy(): void;
}

export interface LanguageDetectorApi {
  availability(): Promise<Availability>;
  create(options?: CreateOptions): Promise<LanguageDetectorInstance>;
}
