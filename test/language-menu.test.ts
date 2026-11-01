import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MENU_TAG, createLanguageMenu, placeMenu, type LanguageMenu } from '../src/content/language-menu';
import type { Settings } from '../src/shared/settings';

let settings: Settings;
let setSettings: ReturnType<typeof vi.fn<(patch: Partial<Settings>) => void>>;
let onTranslate: ReturnType<typeof vi.fn<(id: string) => void>>;
let menu: LanguageMenu;
let anchor: HTMLButtonElement;

function shadow(): ShadowRoot {
  const root = document.querySelector(MENU_TAG)?.shadowRoot;
  if (!root) throw new Error('menu is not open');
  return root;
}

function select(name: 'source' | 'target'): HTMLSelectElement {
  const element = shadow().querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (!element) throw new Error(`no ${name} select`);
  return element;
}

beforeEach(() => {
  document.body.innerHTML = '<button id="anchor">文A</button><p id="elsewhere">chat</p>';
  anchor = document.querySelector('#anchor') as HTMLButtonElement;
  settings = { source: 'auto', target: 'en' };
  setSettings = vi.fn();
  onTranslate = vi.fn();
  menu = createLanguageMenu({ doc: document, getSettings: () => settings, setSettings, onTranslate });
});

afterEach(() => {
  menu.close();
});

describe('language menu', () => {
  it('opens with the current languages and focuses the first one', () => {
    menu.open(anchor, 'msg-1');

    expect(menu.isOpen()).toBe(true);
    expect(select('source').value).toBe('auto');
    expect(select('target').value).toBe('en');
    expect(shadow().activeElement).toBe(select('source'));
  });

  it('saves a language as soon as it changes', () => {
    menu.open(anchor, 'msg-1');

    select('target').value = 'fr';
    select('target').dispatchEvent(new Event('change'));

    expect(setSettings).toHaveBeenCalledWith({ target: 'fr' });
  });

  it('translates the message it was opened for, then closes', () => {
    menu.open(anchor, 'msg-1');

    shadow().querySelector<HTMLButtonElement>('.translate')?.click();

    expect(onTranslate).toHaveBeenCalledWith('msg-1');
    expect(menu.isOpen()).toBe(false);
  });

  it('has no Translate button when opened without a message', () => {
    menu.open(anchor, null);
    expect(shadow().querySelector<HTMLButtonElement>('.translate')?.hidden).toBe(true);
  });

  it('closes on Escape and gives focus back', () => {
    menu.open(anchor, 'msg-1');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(anchor);
  });

  it('closes on a click outside, but not on a click inside', () => {
    menu.open(anchor, 'msg-1');

    select('source').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(menu.isOpen()).toBe(true);

    document.querySelector('#elsewhere')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });

  it('shows settings changed elsewhere while open', () => {
    menu.open(anchor, 'msg-1');
    menu.update({ source: 'es', target: 'ja' });

    expect(select('source').value).toBe('es');
    expect(select('target').value).toBe('ja');
  });

  it('keeps a single menu when reopened', () => {
    menu.open(anchor, 'msg-1');
    menu.open(anchor, 'msg-2');

    expect(document.querySelectorAll(MENU_TAG)).toHaveLength(1);
    shadow().querySelector<HTMLButtonElement>('.translate')?.click();
    expect(onTranslate).toHaveBeenCalledWith('msg-2');
  });
});

describe('placeMenu', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 280, height: 200 };

  it('opens below the anchor, aligned to its left edge', () => {
    expect(placeMenu({ left: 100, top: 100, right: 126, bottom: 126 }, size, viewport)).toEqual({ left: 100, top: 130 });
  });

  it('opens above the anchor when there is no room below', () => {
    expect(placeMenu({ left: 100, top: 700, right: 126, bottom: 726 }, size, viewport)).toEqual({ left: 100, top: 496 });
  });

  it('stays inside the right edge of the window', () => {
    expect(placeMenu({ left: 900, top: 100, right: 926, bottom: 126 }, size, viewport)).toEqual({ left: 712, top: 130 });
  });
});
