import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/shared/engine-client';
import { FakeLanguageDetectorApi, FakeTranslatorApi } from './fakes/built-in-ai';
import { flush, installFakeChrome } from './fakes/chrome';

beforeEach(() => {
  vi.resetModules();
});

describe('service worker', () => {
  it("serves engine ports with Chrome's built-in Translator and LanguageDetector", async () => {
    installFakeChrome();
    const detector = new FakeLanguageDetectorApi();
    detector.results.set('hola', [{ detectedLanguage: 'es', confidence: 0.9 }]);
    vi.stubGlobal('Translator', new FakeTranslatorApi().set('es', 'en', 'available'));
    vi.stubGlobal('LanguageDetector', detector);

    await import('../src/background/service-worker');

    await expect(request({ type: 'translate', text: 'hola', source: 'auto', target: 'en' })).resolves.toMatchObject({
      text: '[es>en] hola',
      source: 'es',
    });
  });

  it('leaves ports with other names alone', async () => {
    const { chrome } = installFakeChrome();
    vi.stubGlobal('Translator', new FakeTranslatorApi().set('es', 'en', 'available'));
    await import('../src/background/service-worker');

    const port = chrome.runtime.connect({ name: 'something-else' });
    const received = vi.fn();
    port.onMessage.addListener(received);
    port.postMessage({ type: 'translate', text: 'hola', source: 'es', target: 'en' });
    await flush();

    expect(received).not.toHaveBeenCalled();
  });
});
