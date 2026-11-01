import type { LanguageDetectorApi, TranslatorApi } from '../shared/built-in-ai';
import { PORT_NAME } from '../shared/protocol';
import { chromeI18nFallback, createDetector } from './detect';
import { createEngine } from './engine';
import { servePort } from './port-server';

// Extension service workers get both APIs without a user gesture (Chrome 138+),
// so every Chat frame, including Gmail's cross-origin ones, translates through here.
const scope = globalThis as { Translator?: TranslatorApi; LanguageDetector?: LanguageDetectorApi };

const engine = createEngine({
  translator: scope.Translator,
  detector: createDetector({ api: scope.LanguageDetector, fallback: chromeI18nFallback }),
  isOnline: () => navigator.onLine,
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_NAME) servePort(port, engine);
});
