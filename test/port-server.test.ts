import { describe, expect, it, vi } from 'vitest';
import { createDetector } from '../src/background/detect';
import { createEngine, type Engine } from '../src/background/engine';
import { servePort } from '../src/background/port-server';
import { request } from '../src/shared/engine-client';
import { PORT_NAME } from '../src/shared/protocol';
import { FakeLanguageDetectorApi, FakeTranslatorApi, gate } from './fakes/built-in-ai';
import { flush, installFakeChrome } from './fakes/chrome';

function setup(engineOverride?: Engine) {
  const { chrome } = installFakeChrome();
  const translator = new FakeTranslatorApi();
  const detectorApi = new FakeLanguageDetectorApi();
  const engine =
    engineOverride ?? createEngine({ translator, detector: createDetector({ api: detectorApi, fallback: async () => [] }) });
  chrome.runtime.onConnect.addListener((port) => servePort(port as unknown as chrome.runtime.Port, engine));
  return { chrome, translator, detectorApi };
}

describe('servePort', () => {
  it('answers translate requests', async () => {
    const { translator } = setup();
    translator.set('es', 'en', 'available');

    await expect(request({ type: 'translate', text: 'hola', source: 'es', target: 'en' })).resolves.toEqual({
      kind: 'translated',
      text: '[es>en] hola',
      source: 'es',
      target: 'en',
    });
  });

  it('streams download progress to the client', async () => {
    const { translator } = setup();
    translator.set('es', 'en', 'downloadable');
    const onProgress = vi.fn();

    await request({ type: 'download', source: 'es', target: 'en' }, { onProgress });

    expect(onProgress).toHaveBeenLastCalledWith({ type: 'progress', loaded: 1, source: 'es', target: 'en' });
  });

  it('answers status requests', async () => {
    const { translator } = setup();
    translator.set('ja', 'en', 'available');

    await expect(request({ type: 'status', target: 'en' })).resolves.toEqual({
      supported: true,
      detector: 'available',
      ready: ['ja'],
    });
  });

  it('downloads the detection model on request', async () => {
    const { detectorApi } = setup();
    detectorApi.state = 'downloadable';

    await expect(request({ type: 'download-detector' })).resolves.toBeNull();
    expect(detectorApi.state).toBe('available');
  });

  it('passes engine errors through with their code', async () => {
    setup();
    await expect(request({ type: 'translate', text: 'hola', source: 'es', target: 'kn' })).rejects.toMatchObject({
      code: 'unsupported-pair',
      source: 'es',
      target: 'kn',
    });
  });

  it('reports unexpected failures as translate-failed', async () => {
    const broken = {
      translate: async () => {
        throw new TypeError('boom');
      },
    } as unknown as Engine;
    setup(broken);

    await expect(request({ type: 'translate', text: 'hola', source: 'es', target: 'en' })).rejects.toMatchObject({
      code: 'translate-failed',
    });
  });

  it('does not answer keep-alive pings', async () => {
    const { chrome } = setup();
    const port = chrome.runtime.connect({ name: PORT_NAME });
    const received = vi.fn();
    port.onMessage.addListener(received);

    port.postMessage({ type: 'ping' });
    await flush();

    expect(received).not.toHaveBeenCalled();
  });

  it('stays quiet when the client leaves mid-request', async () => {
    const { chrome, translator } = setup();
    translator.set('es', 'en', 'downloadable');
    const download = gate();
    translator.downloadGate = download.promise;

    const port = chrome.runtime.connect({ name: PORT_NAME });
    port.postMessage({ type: 'translate', text: 'hola', source: 'es', target: 'en' });
    await flush();
    port.disconnect();
    download.open();
    await flush();

    expect(port.peer.sent).toEqual([{ type: 'progress', loaded: 0, source: 'es', target: 'en' }]);
  });
});
