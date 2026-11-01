import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_TAG, createBlock, renderBlock } from '../src/content/translation-block';
import type { EngineErrorCode } from '../src/shared/protocol';

let host: HTMLElement;
let shadow: ShadowRoot;
const handlers = { onHide: vi.fn(), onMenu: vi.fn() };

function part(selector: string): HTMLElement {
  const element = shadow.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`no ${selector} in the block`);
  return element;
}

beforeEach(() => {
  handlers.onHide.mockReset();
  handlers.onMenu.mockReset();
  document.body.innerHTML = '<div class="message"><div class="body">hola</div></div>';
  host = createBlock(document, 'msg-1', handlers);
  document.querySelector('.body')?.after(host);
  shadow = host.shadowRoot as ShadowRoot;
});

describe('createBlock', () => {
  it('creates a tagged host that Chrome will not page-translate', () => {
    expect(host.localName).toBe(BLOCK_TAG);
    expect(host.getAttribute('data-gct-id')).toBe('msg-1');
    expect(host.getAttribute('translate')).toBe('no');
    expect(shadow).not.toBeNull();
  });

  it('hides the translation from the Hide button and from the 文A control', () => {
    part('.hide').click();
    part('.toggle').click();
    expect(handlers.onHide).toHaveBeenCalledTimes(2);
  });

  it('opens the language menu on right-click instead of the browser menu', () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true });
    part('.header').dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(handlers.onMenu).toHaveBeenCalledWith(part('.toggle'));
  });

  it('keeps clicks inside the block away from Chat', () => {
    const chat = vi.fn();
    document.querySelector('.message')?.addEventListener('click', chat);

    part('.text').click();

    expect(chat).not.toHaveBeenCalled();
  });
});

describe('renderBlock', () => {
  it('shows the translation under its language pair', () => {
    renderBlock(host, {
      state: 'done',
      result: { kind: 'translated', text: 'Shall we meet tomorrow at 3?', source: 'es', target: 'en' },
    });

    expect(part('.label').textContent).toBe('Spanish → English (US)');
    expect(part('.text').textContent).toBe('Shall we meet tomorrow at 3?');
    expect(part('.text').getAttribute('lang')).toBe('en');
    expect(host.getAttribute('data-state')).toBe('done');
  });

  it('says when a message is already in the target language', () => {
    renderBlock(host, { state: 'done', result: { kind: 'same-language', source: 'en', target: 'en' } });

    expect(part('.label').textContent).toBe('Already in English (US)');
    expect(part('.text').hidden).toBe(true);
  });

  it('shows that it is translating', () => {
    renderBlock(host, { state: 'translating' });
    expect(part('.label').textContent).toBe('Translating…');
  });

  it('shows language pack download progress', () => {
    renderBlock(host, { state: 'downloading', loaded: 0.42, source: 'es', target: 'en' });

    expect(part('.label').textContent).toBe('Downloading the Spanish language pack… 42%');
    expect(part('.bar').style.width).toBe('42%');
    expect(part('.text').textContent).toContain('once');
  });

  it("shows Chrome's translation engine downloading, with no percentage to report", () => {
    renderBlock(host, { state: 'downloading', loaded: null, source: 'es', target: 'en' });

    expect(part('.label').textContent).toBe("Downloading Chrome's translation engine…");
    expect(part('.progress').hidden).toBe(true);
    expect(part('.text').textContent).toContain('once');
  });

  it.each<[EngineErrorCode, string]>([
    ['api-unavailable', "On-device translation isn't available in this browser"],
    ['detect-failed', "Couldn't detect the language"],
    ['unsupported-pair', "Chrome can't translate Spanish → Kannada on-device"],
    ['download-failed', "Couldn't download the Spanish language pack"],
    ['translate-failed', 'Translation failed'],
    ['engine-unreachable', 'The extension was updated or reloaded'],
  ])('explains %s', (code, title) => {
    renderBlock(host, { state: 'error', code, source: 'es', target: 'kn' });

    expect(part('.label').textContent).toBe(title);
    expect(part('.text').textContent).not.toBe('');
    expect(host.getAttribute('data-state')).toBe('error');
  });

  it('leaves unchanged text in place, so a selection inside it survives a re-render', () => {
    const view = {
      state: 'done',
      result: { kind: 'translated', text: 'Shall we meet tomorrow at 3?', source: 'es', target: 'en' },
    } as const;
    renderBlock(host, view);
    const textNode = part('.text').firstChild;
    const labelNode = part('.label').firstChild;

    renderBlock(host, view);

    expect(part('.text').firstChild).toBe(textNode);
    expect(part('.label').firstChild).toBe(labelNode);
  });

  it('renders translations as text, never as markup', () => {
    const text = '<img src=x onerror="alert(1)">';
    renderBlock(host, { state: 'done', result: { kind: 'translated', text, source: 'es', target: 'en' } });

    expect(shadow.querySelector('img')).toBeNull();
    expect(part('.text').textContent).toBe(text);
  });
});
