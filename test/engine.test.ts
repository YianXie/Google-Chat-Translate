import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDetector } from '../src/background/detect';
import { createEngine } from '../src/background/engine';
import { FakeLanguageDetectorApi, FakeTranslatorApi, gate } from './fakes/built-in-ai';
import { flush } from './fakes/chrome';

function setup(options: { withTranslator?: boolean } = {}) {
  const translator = new FakeTranslatorApi();
  const detectorApi = new FakeLanguageDetectorApi();
  let online = true;
  const engine = createEngine({
    translator: options.withTranslator === false ? undefined : translator,
    detector: createDetector({ api: detectorApi, fallback: async () => [] }),
    isOnline: () => online,
    stallMs: 15_000,
  });
  return {
    engine,
    translator,
    detectorApi,
    goOffline: () => {
      online = false;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('translate', () => {
  it('detects the language, then translates', async () => {
    const { engine, translator, detectorApi } = setup();
    translator.set('es', 'en', 'available');
    detectorApi.results.set('hola', [{ detectedLanguage: 'es', confidence: 0.9 }]);

    await expect(engine.translate({ text: 'hola', source: 'auto', target: 'en' })).resolves.toEqual({
      kind: 'translated',
      text: '[es>en] hola',
      source: 'es',
      target: 'en',
    });
  });

  it('skips detection when the source language is set', async () => {
    const { engine, translator } = setup();
    translator.set('fr', 'en', 'available');

    await expect(engine.translate({ text: 'hola', source: 'fr', target: 'en' })).resolves.toMatchObject({
      text: '[fr>en] hola',
      source: 'fr',
    });
  });

  it('leaves text that is already in the target language alone', async () => {
    const { engine, translator, detectorApi } = setup();
    detectorApi.results.set('hello', [{ detectedLanguage: 'en', confidence: 0.9 }]);

    await expect(engine.translate({ text: 'hello', source: 'auto', target: 'en' })).resolves.toEqual({
      kind: 'same-language',
      source: 'en',
      target: 'en',
    });
    expect(translator.created).toEqual([]);
  });

  it('fails with detect-failed when no language is recognised', async () => {
    const { engine } = setup();
    await expect(engine.translate({ text: '???', source: 'auto', target: 'en' })).rejects.toMatchObject({
      code: 'detect-failed',
      target: 'en',
    });
  });

  it('fails with api-unavailable when this Chrome has no Translator', async () => {
    const { engine } = setup({ withTranslator: false });
    await expect(engine.translate({ text: 'hola', source: 'es', target: 'en' })).rejects.toMatchObject({
      code: 'api-unavailable',
    });
  });

  it('fails with unsupported-pair when Chrome cannot translate the pair', async () => {
    const { engine } = setup();
    await expect(engine.translate({ text: 'hola', source: 'es', target: 'kn' })).rejects.toMatchObject({
      code: 'unsupported-pair',
      source: 'es',
      target: 'kn',
    });
  });

  it('keeps line breaks and leaves links and emoji-only lines alone', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available');

    const result = await engine.translate({
      text: 'hola\n\nmira esto\nhttps://example.com/a\n👍',
      source: 'es',
      target: 'en',
    });

    expect(result).toMatchObject({ text: '[es>en] hola\n\n[es>en] mira esto\nhttps://example.com/a\n👍' });
    expect(translator.translated).toEqual(['hola', 'mira esto']);
  });

  it('puts links back as they were written when the translator changes them', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available');
    translator.rewrite = (input) => input.replaceAll('informe', 'report');

    const result = await engine.translate({
      text: 'Mira el informe en https://example.com/informe. O en (https://example.com/informe2)',
      source: 'es',
      target: 'en',
    });

    expect(result).toMatchObject({
      text: '[es>en] Mira el report en https://example.com/informe. O en (https://example.com/informe2)',
    });
  });

  it('leaves the translation alone when its links do not line up with the original', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available');
    translator.rewrite = () => 'mira esto';

    await expect(engine.translate({ text: 'Mira https://example.com/a', source: 'es', target: 'en' })).resolves.toMatchObject({
      text: '[es>en] mira esto',
    });
  });

  it('creates one translator per language pair, even for concurrent requests', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available');

    await Promise.all([
      engine.translate({ text: 'uno', source: 'es', target: 'en' }),
      engine.translate({ text: 'dos', source: 'es', target: 'en' }),
    ]);
    await engine.translate({ text: 'tres', source: 'es', target: 'en' });

    expect(translator.created).toEqual(['es>en']);
  });

  it('remembers recent translations', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available');

    await engine.translate({ text: 'hola', source: 'es', target: 'en' });
    await engine.translate({ text: 'hola', source: 'es', target: 'en' });

    expect(translator.translated).toEqual(['hola']);
  });

  it('reports language pack download progress', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    const progress = vi.fn();

    await engine.translate({ text: 'hola', source: 'es', target: 'en' }, progress);

    expect(progress.mock.calls).toEqual([
      [0, 'es', 'en'],
      [0.5, 'es', 'en'],
      [1, 'es', 'en'],
    ]);
  });

  it('shares download progress with every request waiting on the same pair', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    const download = gate();
    translator.downloadGate = download.promise;
    const second = vi.fn();

    const first = engine.translate({ text: 'uno', source: 'es', target: 'en' });
    const other = engine.translate({ text: 'dos', source: 'es', target: 'en' }, second);
    await flush();
    download.open();
    await Promise.all([first, other]);

    expect(second).toHaveBeenLastCalledWith(1, 'es', 'en');
  });

  it('fails with download-failed when a download breaks, and retries next time', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    translator.failNextCreate = true;

    await expect(engine.translate({ text: 'hola', source: 'es', target: 'en' })).rejects.toMatchObject({
      code: 'download-failed',
      source: 'es',
      target: 'en',
    });
    await expect(engine.translate({ text: 'hola', source: 'es', target: 'en' })).resolves.toMatchObject({
      kind: 'translated',
    });
    expect(translator.created).toEqual(['es>en', 'es>en']);
  });

  it('replaces a translator that Chrome broke by installing another language pack', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available').set('zh', 'en', 'downloadable');

    await engine.translate({ text: 'hola', source: 'es', target: 'en' });
    await engine.translate({ text: '你好', source: 'zh', target: 'en' });

    await expect(engine.translate({ text: 'adiós', source: 'es', target: 'en' })).resolves.toMatchObject({
      kind: 'translated',
      text: '[es>en] adiós',
    });
    expect(translator.created).toEqual(['es>en', 'zh>en', 'es>en']);
  });

  it('replaces a broken translator once for all the requests that hit it', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available').set('zh', 'en', 'downloadable');
    await engine.translate({ text: 'hola', source: 'es', target: 'en' });
    await engine.translate({ text: '你好', source: 'zh', target: 'en' });

    const results = await Promise.all([
      engine.translate({ text: 'uno', source: 'es', target: 'en' }),
      engine.translate({ text: 'dos', source: 'es', target: 'en' }),
    ]);

    expect(results).toMatchObject([{ text: '[es>en] uno' }, { text: '[es>en] dos' }]);
    expect(translator.created).toEqual(['es>en', 'zh>en', 'es>en']);
  });

  it('fails with translate-failed when a new translator fails too', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available');
    translator.failTranslations = true;

    await expect(engine.translate({ text: 'hola', source: 'es', target: 'en' })).rejects.toMatchObject({
      code: 'translate-failed',
      source: 'es',
      target: 'en',
    });
    expect(translator.created).toEqual(['es>en', 'es>en']);
  });

  it("waits for Chrome's shared library when a language pack arrives first", async () => {
    vi.useFakeTimers();
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    translator.createsBeforeLibrary = 2;
    const progress = vi.fn();

    const result = engine.translate({ text: 'hola', source: 'es', target: 'en' }, progress);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toMatchObject({ kind: 'translated', text: '[es>en] hola' });
    expect(translator.created).toEqual(['es>en', 'es>en', 'es>en']);
    expect(progress).toHaveBeenCalledWith(null, 'es', 'en');
  });

  it('gives up if the shared library never arrives, then starts over next time', async () => {
    vi.useFakeTimers();
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    translator.createsBeforeLibrary = Number.POSITIVE_INFINITY;

    const result = engine.translate({ text: 'hola', source: 'es', target: 'en' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(await result).toMatchObject({ code: 'download-failed', source: 'es', target: 'en' });
    const attempts = translator.created.length;
    translator.createsBeforeLibrary = 0;
    await expect(engine.translate({ text: 'hola', source: 'es', target: 'en' })).resolves.toMatchObject({ kind: 'translated' });
    expect(translator.created).toHaveLength(attempts + 1);
  });

  it('does not wait for the shared library while offline', async () => {
    vi.useFakeTimers();
    const { engine, translator, goOffline } = setup();
    translator.set('es', 'en', 'downloadable');
    translator.createsBeforeLibrary = Number.POSITIVE_INFINITY;
    goOffline();

    const result = engine.translate({ text: 'hola', source: 'es', target: 'en' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await result).toMatchObject({ code: 'download-failed' });
  });

  it('logs why a download or translation failed, for the service worker console', async () => {
    const { engine, translator } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    translator.set('es', 'en', 'downloadable');
    translator.failNextCreate = true;

    await engine.translate({ text: 'hola', source: 'es', target: 'en' }).catch(() => {});

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('es>en'), expect.objectContaining({ name: 'NetworkError' }));
  });

  it('gives up on a download that stalls while offline', async () => {
    vi.useFakeTimers();
    const { engine, translator, goOffline } = setup();
    translator.set('es', 'en', 'downloadable');
    translator.downloadGate = new Promise(() => {});
    goOffline();

    const result = engine.translate({ text: 'hola', source: 'es', target: 'en' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await result).toMatchObject({ code: 'download-failed', source: 'es', target: 'en' });
  });

  it('keeps waiting on a slow download while online', async () => {
    vi.useFakeTimers();
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    const download = gate();
    translator.downloadGate = download.promise;
    const settled = vi.fn();

    const result = engine.translate({ text: 'hola', source: 'es', target: 'en' }).then(settled, settled);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).not.toHaveBeenCalled();

    download.open();
    await result;
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ kind: 'translated' }));
  });
});

describe('downloads that stop making progress while online', () => {
  it('gives up after five minutes with no progress', async () => {
    vi.useFakeTimers();
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    translator.downloadGate = new Promise(() => {});

    const result = engine.translate({ text: 'hola', source: 'es', target: 'en' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(await result).toMatchObject({ code: 'download-failed', source: 'es', target: 'en' });
  });

  it('keeps going for as long as progress keeps coming', async () => {
    vi.useFakeTimers();
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    translator.downloadGate = new Promise(() => {});
    const settled = vi.fn();

    engine.translate({ text: 'hola', source: 'es', target: 'en' }).then(settled, settled);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    translator.reportDownloadProgress(0.5);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ code: 'download-failed' }));
  });
});

describe('status', () => {
  it('lists the languages that already translate into the target offline', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'available').set('ja', 'en', 'downloadable').set('fr', 'en', 'available').set('es', 'de', 'available');

    await expect(engine.status('en')).resolves.toEqual({ supported: true, detector: 'available', ready: ['es', 'fr'] });
  });

  it('reports when this Chrome has no Translator', async () => {
    const { engine } = setup({ withTranslator: false });
    await expect(engine.status('en')).resolves.toEqual({ supported: false, detector: 'available', ready: [] });
  });
});

describe('downloads', () => {
  it('downloads a language pack ahead of time', async () => {
    const { engine, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    const progress = vi.fn();

    await engine.download('es', 'en', progress);

    await expect(engine.status('en')).resolves.toMatchObject({ ready: ['es'] });
    expect(progress).toHaveBeenLastCalledWith(1, 'es', 'en');
  });

  it('downloads the language detection model', async () => {
    const { engine, detectorApi } = setup();
    detectorApi.state = 'downloadable';
    const progress = vi.fn();

    await engine.downloadDetector(progress);

    expect(detectorApi.state).toBe('available');
    expect(progress).toHaveBeenLastCalledWith(1);
  });

  it('fails with api-unavailable when there is no detection model to download', async () => {
    const { engine, detectorApi } = setup();
    detectorApi.state = 'unavailable';
    await expect(engine.downloadDetector()).rejects.toMatchObject({ code: 'api-unavailable' });
  });
});
