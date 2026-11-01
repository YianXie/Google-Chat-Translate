import type { Availability, LanguagePair, TranslatorApi, TranslatorInstance } from '../shared/built-in-ai';
import { LANGUAGE_CODES, type LanguageCode } from '../shared/languages';
import { EngineError, type StatusResult, type TranslateResult } from '../shared/protocol';
import type { SourceSetting } from '../shared/settings';
import type { Detector } from './detect';

/** `loaded` runs from 0 to 1, or is null while Chrome downloads something it reports no progress for. */
export type ProgressListener = (loaded: number | null, source: LanguageCode, target: LanguageCode) => void;

export interface TranslateInput {
  text: string;
  source: SourceSetting;
  target: LanguageCode;
}

export interface Engine {
  translate(input: TranslateInput, onProgress?: ProgressListener): Promise<TranslateResult>;
  status(target: LanguageCode): Promise<StatusResult>;
  download(source: LanguageCode, target: LanguageCode, onProgress?: ProgressListener): Promise<void>;
  downloadDetector(onProgress?: (loaded: number) => void): Promise<void>;
}

export interface EngineOptions {
  translator: TranslatorApi | undefined;
  detector: Detector;
  isOnline?: () => boolean;
  /** How long a download may go without progress before it is reported as failed, offline and online. */
  stallMs?: number;
  onlineStallMs?: number;
  /** How often to try again, and for how long, while Chrome's shared translation library downloads. */
  libraryRetryMs?: number;
  libraryWaitMs?: number;
  cacheSize?: number;
}

interface PendingTranslator {
  ready: Promise<TranslatorInstance>;
  instance?: TranslatorInstance;
  downloading: boolean;
  listeners: Set<(loaded: number | null) => void>;
}

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/;
const HAS_LETTER = /\p{L}/u;
const LINK = /https?:\/\/[^\s<>"'，。！？；：）】」』]*[^\s<>"'，。！？；：）】」』.,;:!?)\]]/g;

/** Translators change words inside links, so put the originals back when the links line up. */
function restoreLinks(source: string, translated: string): string {
  const links = source.match(LINK);
  if (!links || translated.match(LINK)?.length !== links.length) return translated;
  let next = 0;
  return translated.replace(LINK, () => links[next++] ?? '');
}

/** Translates line by line, so message line breaks survive and link-only lines stay untouched. */
async function translateLines(translator: TranslatorInstance, text: string): Promise<string> {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    lines.push(HAS_LETTER.test(line) && !URL_ONLY.test(line) ? restoreLinks(line, await translator.translate(line)) : line);
  }
  return lines.join('\n');
}

export function createEngine(options: EngineOptions): Engine {
  const {
    translator: api,
    detector,
    isOnline = () => true,
    stallMs = 15_000,
    onlineStallMs = 5 * 60_000,
    libraryRetryMs = 5_000,
    libraryWaitMs = 5 * 60_000,
    cacheSize = 500,
  } = options;
  const translators = new Map<string, PendingTranslator>();
  const cache = new Map<string, string>();

  function recall(key: string): string | undefined {
    const value = cache.get(key);
    if (value !== undefined) {
      cache.delete(key);
      cache.set(key, value);
    }
    return value;
  }

  function remember(key: string, value: string): void {
    cache.set(key, value);
    if (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }

  /**
   * Chrome downloads its shared translation library separately from the language
   * packs. If a pack arrives first, create() throws NotSupportedError until the
   * library is in, even though the pair is supported.
   */
  async function createOnceLibraryIsReady(
    translatorApi: TranslatorApi,
    pair: LanguagePair,
    listeners: PendingTranslator['listeners'],
  ): Promise<TranslatorInstance> {
    const report = (loaded: number | null) => {
      for (const listener of listeners) listener(loaded);
    };
    const deadline = Date.now() + libraryWaitMs;
    for (;;) {
      try {
        return await translatorApi.create({
          ...pair,
          monitor: (monitor) => monitor.addEventListener('downloadprogress', (event) => report(event.loaded)),
        });
      } catch (error) {
        if ((error as { name?: unknown }).name !== 'NotSupportedError' || Date.now() >= deadline) throw error;
      }
      report(null);
      await new Promise((retry) => setTimeout(retry, libraryRetryMs));
    }
  }

  function start(
    translatorApi: TranslatorApi,
    key: string,
    pair: LanguagePair,
    downloading: boolean,
    firstListener: (loaded: number | null) => void,
  ): PendingTranslator {
    // The listener set exists before create() runs: Chrome reports progress 0 synchronously.
    const listeners = new Set([firstListener]);
    const ready = createOnceLibraryIsReady(translatorApi, pair, listeners);
    const pending: PendingTranslator = { ready, downloading, listeners };
    translators.set(key, pending);
    ready.then(
      (instance) => {
        pending.instance = instance;
        pending.downloading = false;
      },
      () => {
        if (translators.get(key) === pending) translators.delete(key);
      },
    );
    return pending;
  }

  /** Waits for a download, but gives up once it stops making progress. Chrome's progress can be coarse, so online gets longer. */
  function untilStalled(pending: PendingTranslator, source: LanguageCode, target: LanguageCode): Promise<TranslatorInstance> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastProgress = Date.now();
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (isOnline() && Date.now() - lastProgress < onlineStallMs) {
            arm();
          } else {
            stop();
            reject(new EngineError('download-failed', source, target));
          }
        }, stallMs);
      };
      const onProgress = (loaded: number | null) => {
        if (loaded === null) return;
        lastProgress = Date.now();
        arm();
      };
      const stop = () => {
        clearTimeout(timer);
        pending.listeners.delete(onProgress);
      };
      pending.listeners.add(onProgress);
      arm();
      pending.ready.then(
        (translator) => {
          stop();
          resolve(translator);
        },
        (error: unknown) => {
          stop();
          reject(error);
        },
      );
    });
  }

  async function translatorFor(
    source: LanguageCode,
    target: LanguageCode,
    onProgress?: ProgressListener,
  ): Promise<TranslatorInstance> {
    if (!api) throw new EngineError('api-unavailable', source, target);
    const key = `${source}>${target}`;
    const listener = (loaded: number | null) => onProgress?.(loaded, source, target);
    let pending = translators.get(key);
    if (pending) {
      pending.listeners.add(listener);
    } else {
      const pair = { sourceLanguage: source, targetLanguage: target };
      const availability = await api.availability(pair).catch((): Availability => 'unavailable');
      if (availability === 'unavailable') throw new EngineError('unsupported-pair', source, target);
      pending = translators.get(key);
      if (pending) pending.listeners.add(listener);
      else pending = start(api, key, pair, availability !== 'available', listener);
    }
    try {
      return await (pending.downloading ? untilStalled(pending, source, target) : pending.ready);
    } catch (error) {
      if (error instanceof EngineError) throw error;
      console.warn(`Google Chat Translate: could not create the ${key} translator`, error);
      throw new EngineError('download-failed', source, target);
    } finally {
      pending.listeners.delete(listener);
    }
  }

  /** Chrome breaks every existing translator when it installs a language pack, so a failure gets one retry on a new one. */
  async function translateText(
    source: LanguageCode,
    target: LanguageCode,
    text: string,
    onProgress?: ProgressListener,
  ): Promise<string> {
    const key = `${source}>${target}`;
    const translator = await translatorFor(source, target, onProgress);
    try {
      return await translateLines(translator, text);
    } catch {
      if (translators.get(key)?.instance === translator) translators.delete(key);
    }
    const replacement = await translatorFor(source, target, onProgress);
    try {
      return await translateLines(replacement, text);
    } catch (error) {
      console.warn(`Google Chat Translate: could not translate ${key}`, error);
      throw new EngineError('translate-failed', source, target);
    }
  }

  async function detect(text: string, target: LanguageCode): Promise<LanguageCode> {
    let detected: LanguageCode | null = null;
    try {
      detected = await detector.detect(text);
    } catch {
      // Reported below.
    }
    if (!detected) throw new EngineError('detect-failed', undefined, target);
    return detected;
  }

  return {
    async translate({ text, source, target }, onProgress) {
      if (!api) throw new EngineError('api-unavailable', undefined, target);
      const from = source === 'auto' ? await detect(text, target) : source;
      if (from === target) return { kind: 'same-language', source: from, target };

      const key = `${from}>${target}\n${text}`;
      let translated = recall(key);
      if (translated === undefined) {
        translated = await translateText(from, target, text, onProgress);
        remember(key, translated);
      }
      return { kind: 'translated', text: translated, source: from, target };
    },

    async status(target) {
      const detectorStatus = await detector.status();
      if (!api) return { supported: false, detector: detectorStatus, ready: [] };
      const checks = await Promise.all(
        LANGUAGE_CODES.filter((code) => code !== target).map(async (code) => {
          const availability = await api
            .availability({ sourceLanguage: code, targetLanguage: target })
            .catch((): Availability => 'unavailable');
          return availability === 'available' ? code : null;
        }),
      );
      return { supported: true, detector: detectorStatus, ready: checks.filter((code) => code !== null) };
    },

    async download(source, target, onProgress) {
      await translatorFor(source, target, onProgress);
    },

    async downloadDetector(onProgress) {
      if ((await detector.status()) === 'unavailable') throw new EngineError('api-unavailable');
      try {
        await detector.download(onProgress);
      } catch (error) {
        console.warn('Google Chat Translate: could not download the language detection model', error);
        throw new EngineError('download-failed');
      }
    },
  };
}
