import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDetector } from '../src/background/detect';
import { createEngine } from '../src/background/engine';
import { servePort } from '../src/background/port-server';
import { startPopup } from '../src/popup/app';
import { FakeLanguageDetectorApi, FakeTranslatorApi, gate } from './fakes/built-in-ai';
import { installFakeChrome } from './fakes/chrome';

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  document.head.replaceChildren();
});

/** The popup with a real engine (over fake Chrome AI APIs) behind fake ports. */
function setup(options: { withTranslator?: boolean; withWorker?: boolean } = {}) {
  const fake = installFakeChrome({ uiLanguage: 'en-US' });
  const translator = new FakeTranslatorApi();
  const detectorApi = new FakeLanguageDetectorApi();
  if (options.withWorker !== false) {
    const engine = createEngine({
      translator: options.withTranslator === false ? undefined : translator,
      detector: createDetector({ api: detectorApi, fallback: async () => [] }),
    });
    fake.chrome.runtime.onConnect.addListener((port) => servePort(port as unknown as chrome.runtime.Port, engine));
  }
  document.body.innerHTML = '<main id="app"></main>';
  return { ...fake, translator, detectorApi };
}

async function open(): Promise<void> {
  stop = await startPopup(document);
  await vi.waitFor(() => expect(find('.status').getAttribute('data-loaded')).toBe('true'));
}

function find<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`no ${selector} in the popup`);
  return element;
}

function change(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

const packOptions = () => [...find<HTMLSelectElement>('.pack').options].map((option) => option.value);

describe('popup', () => {
  it('shows the current languages', async () => {
    const { chrome } = setup();
    await chrome.storage.sync.set({ settings: { source: 'es', target: 'ja' } });

    await open();

    expect(find<HTMLSelectElement>('select[name="source"]').value).toBe('es');
    expect(find<HTMLSelectElement>('select[name="target"]').value).toBe('ja');
  });

  it('saves a language change', async () => {
    const { syncData } = setup();
    await open();

    change(find<HTMLSelectElement>('select[name="target"]'), 'fr');

    await vi.waitFor(() => expect(syncData.settings).toEqual({ source: 'auto', target: 'fr' }));
  });

  it('lists the languages ready offline into the target', async () => {
    const { translator } = setup();
    translator.set('es', 'en', 'available').set('ja', 'en', 'available').set('fr', 'en', 'downloadable');

    await open();

    expect(find('.heading').textContent).toBe('Offline languages into English (US)');
    expect(find('.ready').textContent).toBe('Ready: Spanish, Japanese');
  });

  it('says when no language is ready yet', async () => {
    setup();
    await open();

    expect(find('.ready').textContent).toBe('None downloaded yet');
  });

  it('offers only the languages that still need downloading', async () => {
    const { translator } = setup();
    translator.set('es', 'en', 'available');

    await open();

    expect(packOptions()).toContain('fr');
    expect(packOptions()).not.toContain('es');
    expect(packOptions()).not.toContain('en');
  });

  it('preselects the source language when it still needs downloading', async () => {
    const { chrome } = setup();
    await chrome.storage.sync.set({ settings: { source: 'ko', target: 'en' } });

    await open();

    expect(find<HTMLSelectElement>('.pack').value).toBe('ko');
  });

  it('downloads a language pack, showing progress, then lists it as ready', async () => {
    const { translator } = setup();
    translator.set('fr', 'en', 'downloadable');
    const download = gate();
    translator.downloadGate = download.promise;
    await open();

    change(find<HTMLSelectElement>('.pack'), 'fr');
    find('.download').click();

    await vi.waitFor(() => expect(find('.progress').hidden).toBe(false));
    expect(find<HTMLButtonElement>('.download').disabled).toBe(true);

    download.open();

    await vi.waitFor(() => expect(find('.ready').textContent).toBe('Ready: French'));
    expect(find('.progress').hidden).toBe(true);
    expect(find<HTMLButtonElement>('.download').disabled).toBe(false);
  });

  it('explains a failed download and lets the person try again', async () => {
    const { translator } = setup();
    translator.set('fr', 'en', 'downloadable');
    translator.failNextCreate = true;
    await open();

    change(find<HTMLSelectElement>('.pack'), 'fr');
    find('.download').click();

    await vi.waitFor(() => expect(find('.message').textContent).toContain("Couldn't download the French language pack"));
    expect(find('.message').hidden).toBe(false);
    expect(find<HTMLButtonElement>('.download').disabled).toBe(false);
  });

  it('follows language changes made in the right-click menu', async () => {
    const { chrome, translator } = setup();
    translator.set('es', 'de', 'available');
    await open();

    await chrome.storage.sync.set({ settings: { source: 'auto', target: 'de' } });

    await vi.waitFor(() => expect(find('.ready').textContent).toBe('Ready: Spanish'));
    expect(find<HTMLSelectElement>('select[name="target"]').value).toBe('de');
    expect(find('.heading').textContent).toBe('Offline languages into German');
  });

  it('shows when the auto-detect model is ready', async () => {
    setup();
    await open();

    expect(find('.detector').textContent).toBe('Auto-detect: ready offline');
    expect(find('.download-detector').hidden).toBe(true);
  });

  it('offers to download the auto-detect model', async () => {
    const { detectorApi } = setup();
    detectorApi.state = 'downloadable';
    await open();

    expect(find('.detector').textContent).toBe('Auto-detect: more accurate with its model');
    find('.download-detector').click();

    await vi.waitFor(() => expect(find('.detector').textContent).toBe('Auto-detect: ready offline'));
    expect(detectorApi.state).toBe('available');
  });

  it('explains when this Chrome cannot translate on-device', async () => {
    setup({ withTranslator: false });
    await open();

    expect(find('.banner').hidden).toBe(false);
    expect(find('.banner').textContent).toContain("On-device translation isn't available in this browser");
    expect(find('.offline').hidden).toBe(true);
  });

  it('explains when the translator cannot be reached', async () => {
    setup({ withWorker: false });
    await open();

    expect(find('.banner').hidden).toBe(false);
    expect(find('.banner').textContent).toContain('The extension was updated or reloaded');
  });
});
