import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/shared/engine-client';
import { EngineError, PORT_NAME } from '../src/shared/protocol';
import { type FakePort, installFakeChrome } from './fakes/chrome';

type FakeChrome = ReturnType<typeof installFakeChrome>['chrome'];

/** A stand-in service worker that answers every non-ping request with `answer`. */
function serve(chrome: FakeChrome, answer: (message: unknown, port: FakePort) => void): void {
  chrome.runtime.onConnect.addListener((port) => {
    port.onMessage.addListener((message) => {
      if ((message as { type: string }).type !== 'ping') answer(message, port);
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('request', () => {
  it('resolves with the result the engine sends back', async () => {
    const { chrome } = installFakeChrome();
    serve(chrome, (_message, port) =>
      port.postMessage({ type: 'done', result: { kind: 'translated', text: 'hello', source: 'es', target: 'en' } }),
    );

    await expect(request({ type: 'translate', text: 'hola', source: 'auto', target: 'en' })).resolves.toEqual({
      kind: 'translated',
      text: 'hello',
      source: 'es',
      target: 'en',
    });
  });

  it('sends the request over the engine port', async () => {
    const { chrome } = installFakeChrome();
    const received: { name: string; message: unknown }[] = [];
    serve(chrome, (message, port) => {
      received.push({ name: port.name, message });
      port.postMessage({ type: 'done', result: null });
    });

    await request({ type: 'download-detector' });

    expect(received).toEqual([{ name: PORT_NAME, message: { type: 'download-detector' } }]);
  });

  it('reports download progress before the result', async () => {
    const { chrome } = installFakeChrome();
    serve(chrome, (_message, port) => {
      port.postMessage({ type: 'progress', loaded: 0.5, source: 'es', target: 'en' });
      port.postMessage({ type: 'done', result: null });
    });
    const onProgress = vi.fn();

    await request({ type: 'download', source: 'es', target: 'en' }, { onProgress });

    expect(onProgress).toHaveBeenCalledWith({ type: 'progress', loaded: 0.5, source: 'es', target: 'en' });
  });

  it('rejects with the error the engine reports', async () => {
    const { chrome } = installFakeChrome();
    serve(chrome, (_message, port) => port.postMessage({ type: 'error', code: 'unsupported-pair', source: 'es', target: 'kn' }));

    const error: unknown = await request({ type: 'translate', text: 'hola', source: 'es', target: 'kn' }).catch((e) => e);

    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({ code: 'unsupported-pair', source: 'es', target: 'kn' });
  });

  it('rejects as unreachable when the port closes before an answer', async () => {
    const { chrome } = installFakeChrome();
    serve(chrome, (_message, port) => port.disconnect());

    await expect(request({ type: 'download-detector' })).rejects.toMatchObject({ code: 'engine-unreachable' });
  });

  it('rejects as unreachable when nothing is listening', async () => {
    installFakeChrome();

    await expect(request({ type: 'download-detector' })).rejects.toMatchObject({ code: 'engine-unreachable' });
  });

  it('rejects as unreachable after the extension was reloaded', async () => {
    const fake = installFakeChrome();
    fake.invalidateContext();

    await expect(request({ type: 'download-detector' })).rejects.toMatchObject({ code: 'engine-unreachable' });
  });

  it('pings while it waits, and stops once the answer arrives', async () => {
    vi.useFakeTimers();
    const { chrome } = installFakeChrome();
    let workerPort: FakePort | undefined;
    let pings = 0;
    chrome.runtime.onConnect.addListener((port) => {
      workerPort = port;
      port.onMessage.addListener((message) => {
        if ((message as { type: string }).type === 'ping') pings += 1;
      });
    });

    const pending = request({ type: 'download', source: 'es', target: 'en' }, { keepAliveMs: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(pings).toBe(3);

    workerPort?.postMessage({ type: 'done', result: null });
    await pending;
    await vi.advanceTimersByTimeAsync(3000);
    expect(pings).toBe(3);
  });

  it('closes its port once the request settles', async () => {
    const { chrome } = installFakeChrome();
    const closed = vi.fn();
    serve(chrome, (_message, port) => {
      port.onDisconnect.addListener(closed);
      port.postMessage({ type: 'done', result: null });
    });

    await request({ type: 'download-detector' });
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
  });
});
