import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SELECTORS } from '../src/content/chat-dom';
import { createController, type Controller, type ControllerDeps } from '../src/content/controller';
import { EngineError, type DownloadProgress, type TranslateResult } from '../src/shared/protocol';
import type { Settings } from '../src/shared/settings';
import { flush } from './fakes/chrome';

type Translate = (text: string, settings: Settings, onProgress: (progress: DownloadProgress) => void) => Promise<TranslateResult>;

const fixture = readFileSync('test/fixtures/chat.html', 'utf8');

let settings: Settings;
let translate: ReturnType<typeof vi.fn<Translate>>;
let onMenu: ReturnType<typeof vi.fn<ControllerDeps['onMenu']>>;
let controller: Controller;

function fakeTranslation(text: string, target = settings.target): TranslateResult {
  return { kind: 'translated', text: `${target.toUpperCase()}: ${text}`, source: 'es', target };
}

function message(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[role="main"] [data-id="${id}"]`);
  if (!element) throw new Error(`no message ${id}`);
  return element;
}

function blocks(id: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('gct-translation')].filter(
    (block) => block.getAttribute('data-gct-id') === id,
  );
}

function firstBlock(id: string): HTMLElement {
  const [block] = blocks(id);
  if (!block) throw new Error(`no block for ${id}`);
  return block;
}

const label = (block: HTMLElement) => block.shadowRoot?.querySelector('.label')?.textContent;
const shownText = (block: HTMLElement) => block.shadowRoot?.querySelector('.text')?.textContent;

beforeEach(() => {
  document.body.innerHTML = fixture;
  settings = { source: 'auto', target: 'en' };
  translate = vi.fn<Translate>(async (text, current) => fakeTranslation(text, current.target));
  onMenu = vi.fn<ControllerDeps['onMenu']>();
  controller = createController({ doc: document, getSettings: () => settings, translate, onMenu });
});

describe('controller', () => {
  it('shows the translation right after the message body', async () => {
    controller.toggle(message('msg-es'));
    await flush();

    const block = firstBlock('msg-es');
    expect(block.previousElementSibling?.id).toBe('msg-es/qJTHM');
    expect(shownText(block)).toBe('EN: ¿Nos vemos mañana a las 3?');
    expect(translate).toHaveBeenCalledWith('¿Nos vemos mañana a las 3?', { source: 'auto', target: 'en' }, expect.any(Function));
  });

  it("matches the block to the message body's text size and inset", async () => {
    const body = message('msg-es').querySelector<HTMLElement>('[jsname="bgckF"]');
    if (body) body.style.cssText = 'font-size: 14px; line-height: 20px; padding: 8px 12px';

    controller.toggle(message('msg-es'));
    await flush();

    expect(firstBlock('msg-es').style).toMatchObject({
      fontSize: '14px',
      lineHeight: '20px',
      paddingLeft: '12px',
      paddingRight: '12px',
      paddingBottom: '8px',
    });
  });

  it('puts a block under every copy of the message', async () => {
    controller.toggle(message('msg-es'));
    await flush();

    expect(blocks('msg-es')).toHaveLength(2);
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('shows progress until the engine answers', async () => {
    let finish!: (result: TranslateResult) => void;
    let report!: (progress: DownloadProgress) => void;
    translate.mockImplementation((_text, _settings, onProgress) => {
      report = onProgress;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    controller.toggle(message('msg-es'));
    expect(label(firstBlock('msg-es'))).toBe('Translating…');

    report({ type: 'progress', loaded: 0.42, source: 'es', target: 'en' });
    expect(label(firstBlock('msg-es'))).toBe('Downloading the Spanish language pack… 42%');

    finish(fakeTranslation('hola'));
    await flush();
    expect(firstBlock('msg-es').getAttribute('data-state')).toBe('done');
  });

  it('hides the translation when toggled again, and reshows it without translating again', async () => {
    controller.toggle(message('msg-es'));
    await flush();
    controller.toggle(message('msg-es'));
    expect(blocks('msg-es')).toHaveLength(0);
    expect(controller.isOpen('msg-es')).toBe(false);

    controller.toggle(message('msg-es'));
    await flush();
    expect(blocks('msg-es')).toHaveLength(2);
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("hides the translation from the block's Hide button", async () => {
    controller.toggle(message('msg-es'));
    await flush();

    firstBlock('msg-es').shadowRoot?.querySelector<HTMLElement>('.hide')?.click();

    expect(blocks('msg-es')).toHaveLength(0);
  });

  it('opens the language menu from the block header', async () => {
    controller.toggle(message('msg-es'));
    await flush();

    firstBlock('msg-es')
      .shadowRoot?.querySelector('.header')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(onMenu).toHaveBeenCalledWith(expect.any(HTMLElement), 'msg-es');
  });

  it('ignores messages with no words to translate', async () => {
    controller.toggle(message('msg-emoji'));
    await flush();

    expect(blocks('msg-emoji')).toHaveLength(0);
    expect(translate).not.toHaveBeenCalled();
  });

  it('shows a message by id, as the language menu does', async () => {
    controller.show('msg-rich');
    await flush();

    expect(shownText(firstBlock('msg-rich'))).toBe('EN: Hola @Ben Li, mira este enlace 😀\nSegunda línea\nTercera línea');
  });

  it('puts the block back after Chat re-renders the message', async () => {
    controller.toggle(message('msg-es'));
    await flush();
    const bubble = message('msg-es').querySelector('[jsname="o7uNDd"]');
    const fresh = message('msg-es').querySelector('[jsname="bgckF"]')?.cloneNode(true) as HTMLElement;
    bubble?.replaceChildren(fresh);
    expect(fresh.nextElementSibling).toBeNull();

    controller.reconcile();

    expect(fresh.nextElementSibling?.localName).toBe('gct-translation');
    expect(shownText(fresh.nextElementSibling as HTMLElement)).toBe('EN: ¿Nos vemos mañana a las 3?');
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it('translates again when the message is edited', async () => {
    controller.toggle(message('msg-es'));
    await flush();
    const body = message('msg-es').querySelector('[jsname="bgckF"]');
    if (body) body.textContent = 'Mejor a las 4';

    controller.reconcile();
    await flush();

    expect(translate).toHaveBeenLastCalledWith('Mejor a las 4', settings, expect.any(Function));
    expect(shownText(firstBlock('msg-es'))).toBe('EN: Mejor a las 4');
  });

  it('translates open messages again when the settings change, and leaves closed ones alone', async () => {
    controller.toggle(message('msg-es'));
    controller.toggle(message('msg-rich'));
    await flush();
    controller.toggle(message('msg-rich'));

    settings = { source: 'auto', target: 'fr' };
    controller.refresh();
    await flush();

    expect(shownText(firstBlock('msg-es'))).toBe('FR: ¿Nos vemos mañana a las 3?');
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it('drops a result that arrives after a newer request', async () => {
    const answers: ((result: TranslateResult) => void)[] = [];
    translate.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));

    controller.toggle(message('msg-es'));
    settings = { source: 'auto', target: 'fr' };
    controller.refresh();
    answers[1]?.(fakeTranslation('nuevo', 'fr'));
    answers[0]?.(fakeTranslation('viejo', 'en'));
    await flush();

    expect(shownText(firstBlock('msg-es'))).toBe('FR: nuevo');
  });

  it('shows engine errors in the block', async () => {
    translate.mockRejectedValue(new EngineError('unsupported-pair', 'es', 'kn'));

    controller.toggle(message('msg-es'));
    await flush();

    expect(firstBlock('msg-es').getAttribute('data-state')).toBe('error');
    expect(label(firstBlock('msg-es'))).toBe("Chrome can't translate Spanish → Kannada on-device");
  });

  it('tries again after an error', async () => {
    translate.mockRejectedValueOnce(new EngineError('translate-failed'));

    controller.toggle(message('msg-es'));
    await flush();
    controller.toggle(message('msg-es'));
    controller.toggle(message('msg-es'));
    await flush();

    expect(translate).toHaveBeenCalledTimes(2);
    expect(firstBlock('msg-es').getAttribute('data-state')).toBe('done');
  });

  it('scans the page for messages once per reconcile, however many translations are open', async () => {
    controller.toggle(message('msg-es'));
    controller.toggle(message('msg-rich'));
    controller.toggle(message('msg-fallback'));
    await flush();
    const scan = vi.spyOn(document, 'querySelectorAll');

    controller.reconcile();

    expect(scan.mock.calls.filter(([selector]) => selector === SELECTORS.message)).toHaveLength(1);
  });

  it('does not scan the page at all while nothing is translated', () => {
    const scan = vi.spyOn(document, 'querySelectorAll');

    controller.reconcile();

    expect(scan.mock.calls.filter(([selector]) => selector === SELECTORS.message)).toHaveLength(0);
  });

  it('removes blocks that lost their message', async () => {
    controller.toggle(message('msg-es'));
    await flush();
    const stray = firstBlock('msg-es');
    document.body.append(stray);

    controller.reconcile();

    expect(stray.isConnected).toBe(false);
    expect(blocks('msg-es')).toHaveLength(2);
  });
});
