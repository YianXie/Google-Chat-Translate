import { describe, expect, it, vi } from 'vitest';
import { chromeI18nFallback, createDetector, looksTraditional, pickLanguage } from '../src/background/detect';
import { FakeLanguageDetectorApi, gate } from './fakes/built-in-ai';
import { flush, installFakeChrome } from './fakes/chrome';

describe('pickLanguage', () => {
  it('takes the most confident language Chrome can translate', () => {
    expect(
      pickLanguage(
        [
          { detectedLanguage: 'pt', confidence: 0.2 },
          { detectedLanguage: 'es', confidence: 0.7 },
        ],
        'hola',
      ),
    ).toBe('es');
  });

  it('skips undetermined and unsupported candidates', () => {
    expect(
      pickLanguage(
        [
          { detectedLanguage: 'und', confidence: 0.6 },
          { detectedLanguage: 'la', confidence: 0.3 },
          { detectedLanguage: 'it', confidence: 0.1 },
        ],
        'lorem',
      ),
    ).toBe('it');
  });

  it('maps legacy detector codes', () => {
    expect(pickLanguage([{ detectedLanguage: 'iw', confidence: 0.9 }], 'שלום')).toBe('he');
  });

  it('tells Traditional Chinese apart from Simplified', () => {
    expect(pickLanguage([{ detectedLanguage: 'zh', confidence: 0.9 }], '謝謝你們的幫忙')).toBe('zh-Hant');
    expect(pickLanguage([{ detectedLanguage: 'zh', confidence: 0.9 }], '谢谢你们的帮忙')).toBe('zh');
  });

  it('returns null when nothing usable was detected', () => {
    expect(pickLanguage([{ detectedLanguage: 'und', confidence: 1 }], '👍')).toBeNull();
    expect(pickLanguage([], '')).toBeNull();
  });
});

describe('looksTraditional', () => {
  it('counts characters that differ between the two scripts', () => {
    expect(looksTraditional('這個問題我們明天再說')).toBe(true);
    expect(looksTraditional('这个问题我们明天再说')).toBe(false);
  });

  it('is false for text without script-specific characters', () => {
    expect(looksTraditional('hello')).toBe(false);
    expect(looksTraditional('明天')).toBe(false);
  });
});

describe('chromeI18nFallback', () => {
  it('turns chrome.i18n.detectLanguage percentages into confidences', async () => {
    const { chrome } = installFakeChrome();
    chrome.i18n.detectLanguage.mockResolvedValue({
      isReliable: false,
      languages: [
        { language: 'es', percentage: 80 },
        { language: 'pt', percentage: 20 },
      ],
    });

    await expect(chromeI18nFallback('hola')).resolves.toEqual([
      { detectedLanguage: 'es', confidence: 0.8 },
      { detectedLanguage: 'pt', confidence: 0.2 },
    ]);
  });
});

describe('createDetector', () => {
  const spanish = [{ detectedLanguage: 'es', confidence: 0.9 }];
  const french = [{ detectedLanguage: 'fr', confidence: 0.9 }];

  it('uses the on-device LanguageDetector when it is ready', async () => {
    const api = new FakeLanguageDetectorApi();
    api.results.set('hola', spanish);
    const fallback = vi.fn(async () => french);

    await expect(createDetector({ api, fallback }).detect('hola')).resolves.toBe('es');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back when this Chrome has no LanguageDetector', async () => {
    const detector = createDetector({ fallback: async () => french });
    await expect(detector.detect('bonjour')).resolves.toBe('fr');
  });

  it('answers from the fallback while the model downloads in the background', async () => {
    const api = new FakeLanguageDetectorApi();
    api.state = 'downloadable';
    const download = gate();
    api.downloadGate = download.promise;
    api.results.set('hola', spanish);
    const detector = createDetector({ api, fallback: async () => french });

    await expect(detector.detect('hola')).resolves.toBe('fr');
    expect(api.creates).toBe(1);

    download.open();
    await flush();
    await expect(detector.detect('hola')).resolves.toBe('es');
    expect(api.creates).toBe(1);
  });

  it('falls back when the model fails to load', async () => {
    const api = new FakeLanguageDetectorApi();
    api.state = 'unavailable';
    const detector = createDetector({ api, fallback: async () => french });
    await expect(detector.detect('bonjour')).resolves.toBe('fr');
  });

  it('reports the model status and downloads it on request', async () => {
    const api = new FakeLanguageDetectorApi();
    api.state = 'downloadable';
    const detector = createDetector({ api, fallback: async () => [] });
    const progress = vi.fn();

    await expect(detector.status()).resolves.toBe('downloadable');
    await detector.download(progress);

    await expect(detector.status()).resolves.toBe('available');
    expect(progress).toHaveBeenLastCalledWith(1);
  });

  it('reports the model as unavailable when this Chrome has no LanguageDetector', async () => {
    await expect(createDetector({ fallback: async () => [] }).status()).resolves.toBe('unavailable');
  });
});
