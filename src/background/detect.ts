import type {
  Availability,
  DetectionCandidate,
  LanguageDetectorApi,
  LanguageDetectorInstance,
} from '../shared/built-in-ai';
import { normalizeLanguage, type LanguageCode } from '../shared/languages';

export type DetectFallback = (text: string) => Promise<DetectionCandidate[]>;

export interface Detector {
  detect(text: string): Promise<LanguageCode | null>;
  status(): Promise<Availability>;
  download(onProgress?: (loaded: number) => void): Promise<void>;
}

// Common characters that Traditional and Simplified Chinese write differently.
const TRADITIONAL = new Set('們這個來說時會對國學後過還發經點問題開關見頭電話網買賣東車長門書寫讀聽語紅體與為無從聲樂應該讓請謝氣當實現樣種覺機場歡麼邊嗎傳號錢給認識幫');
const SIMPLIFIED = new Set('们这个来说时会对国学后过还发经点问题开关见头电话网买卖东车长门书写读听语红体与为无从声乐应该让请谢气当实现样种觉机场欢么边吗传号钱给认识帮');

function countScripts(text: string): { traditional: number; simplified: number } {
  let traditional = 0;
  let simplified = 0;
  for (const char of text) {
    if (TRADITIONAL.has(char)) traditional += 1;
    else if (SIMPLIFIED.has(char)) simplified += 1;
  }
  return { traditional, simplified };
}

export function looksTraditional(text: string): boolean {
  const { traditional, simplified } = countScripts(text);
  return traditional > simplified;
}

/** The most confident candidate Chrome can translate. Detectors report both Chinese scripts as "zh". */
export function pickLanguage(candidates: DetectionCandidate[], text: string): LanguageCode | null {
  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  for (const { detectedLanguage } of ranked) {
    const code = normalizeLanguage(detectedLanguage);
    if (code === 'zh' || code === 'zh-Hant') {
      const { traditional, simplified } = countScripts(text);
      if (traditional > simplified) return 'zh-Hant';
      if (simplified > traditional) return 'zh';
    }
    if (code) return code;
  }
  return null;
}

/** chrome.i18n.detectLanguage (CLD3): always offline, but unreliable on short messages. */
export const chromeI18nFallback: DetectFallback = async (text) => {
  const { languages } = await chrome.i18n.detectLanguage(text);
  return languages.map(({ language, percentage }) => ({ detectedLanguage: language, confidence: percentage / 100 }));
};

export function createDetector(options: { api?: LanguageDetectorApi; fallback: DetectFallback }): Detector {
  const { api, fallback } = options;
  const progressListeners = new Set<(loaded: number) => void>();
  let model: LanguageDetectorInstance | null = null;
  let loading: Promise<void> | null = null;

  function load(detectorApi: LanguageDetectorApi): Promise<void> {
    loading ??= detectorApi
      .create({
        monitor: (monitor) =>
          monitor.addEventListener('downloadprogress', (event) => {
            for (const listener of progressListeners) listener(event.loaded);
          }),
      })
      .then(
        (instance) => {
          model = instance;
        },
        (error: unknown) => {
          loading = null;
          throw error;
        },
      );
    return loading;
  }

  async function candidates(text: string): Promise<DetectionCandidate[]> {
    if (api && !model) {
      const availability = await api.availability().catch((): Availability => 'unavailable');
      if (availability === 'available') await load(api).catch(() => {});
      // The model downloads in the background; the fallback answers meanwhile.
      else if (availability !== 'unavailable') load(api).catch(() => {});
    }
    if (model) {
      try {
        return await model.detect(text);
      } catch {
        // Use the fallback below.
      }
    }
    return fallback(text);
  }

  return {
    detect: async (text) => pickLanguage(await candidates(text), text),
    status: async () => (api ? api.availability().catch((): Availability => 'unavailable') : 'unavailable'),
    download: async (onProgress) => {
      if (!api) throw new Error('LanguageDetector is unavailable');
      if (onProgress) progressListeners.add(onProgress);
      try {
        await load(api);
      } finally {
        if (onProgress) progressListeners.delete(onProgress);
      }
    },
  };
}
