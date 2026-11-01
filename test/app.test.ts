import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDetector } from '../src/background/detect';
import { createEngine } from '../src/background/engine';
import { servePort } from '../src/background/port-server';
import { startContentScript } from '../src/content/app';
import { FakeLanguageDetectorApi, FakeTranslatorApi } from './fakes/built-in-ai';
import { installFakeChrome } from './fakes/chrome';

const fixture = readFileSync('test/fixtures/chat.html', 'utf8');
const SPANISH = '¿Nos vemos mañana a las 3?';

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
});

/** The content script against the fixture, talking to a real engine (with fake Chrome AI APIs) over fake ports. */
async function boot() {
  const fake = installFakeChrome();
  const translator = new FakeTranslatorApi().set('es', 'en', 'available').set('es', 'fr', 'available');
  const detectorApi = new FakeLanguageDetectorApi();
  detectorApi.results.set(SPANISH, [{ detectedLanguage: 'es', confidence: 0.9 }]);
  const engine = createEngine({ translator, detector: createDetector({ api: detectorApi, fallback: async () => [] }) });
  fake.chrome.runtime.onConnect.addListener((port) => servePort(port as unknown as chrome.runtime.Port, engine));
  document.body.innerHTML = fixture;
  stop = await startContentScript(document);
  return fake;
}

function mainBody(): HTMLElement {
  const body = document.querySelector<HTMLElement>('[role="main"] [data-id="msg-es"] [jsname="bgckF"]');
  if (!body) throw new Error('fixture body missing');
  return body;
}

function overlayButton(): HTMLButtonElement {
  const button = document.querySelector('gct-overlay')?.shadowRoot?.querySelector('button');
  if (!button) throw new Error('overlay button missing');
  return button;
}

function translationAfter(body: Element): string | null | undefined {
  return (body.nextElementSibling as HTMLElement | null)?.shadowRoot?.querySelector('.text')?.textContent;
}

async function translateFirstMessage(): Promise<void> {
  mainBody().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  overlayButton().click();
  await vi.waitFor(() => expect(translationAfter(mainBody())).toBe(`[es>en] ${SPANISH}`));
}

describe('content script', () => {
  it('translates a message from its floating button', async () => {
    await boot();
    await translateFirstMessage();
  });

  it('opens the language menu when the button is right-clicked', async () => {
    await boot();
    mainBody().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    overlayButton().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true }));

    expect(document.querySelector('gct-menu')).not.toBeNull();
  });

  it('updates shown translations when the languages change in another tab or the popup', async () => {
    const { chrome } = await boot();
    await translateFirstMessage();

    await chrome.storage.sync.set({ settings: { source: 'auto', target: 'fr' } });

    await vi.waitFor(() => expect(translationAfter(mainBody())).toBe(`[es>fr] ${SPANISH}`));
  });

  it('puts translations back after Chat re-renders a message', async () => {
    await boot();
    await translateFirstMessage();
    const fresh = mainBody().cloneNode(true) as HTMLElement;

    mainBody().parentElement?.replaceChildren(fresh);

    await vi.waitFor(() => expect(translationAfter(fresh)).toBe(`[es>en] ${SPANISH}`));
  });

  it('removes its UI when stopped', async () => {
    await boot();
    stop?.();
    stop = undefined;

    expect(document.querySelector('gct-overlay')).toBeNull();
  });
});
