import { createHost, h, themeOf } from '../shared/dom';
import { createLanguagePicker, type LanguagePicker } from '../shared/language-picker';
import type { Settings } from '../shared/settings';
import { MENU_CSS } from './styles';

export const MENU_TAG = 'gct-menu';

export interface LanguageMenuDeps {
  doc: Document;
  getSettings(): Settings;
  setSettings(patch: Partial<Settings>): unknown;
  onTranslate(id: string): void;
}

export interface LanguageMenu {
  /** `id` is the message the menu was opened from, if any. */
  open(anchor: Element, id: string | null): void;
  close(): void;
  isOpen(): boolean;
  update(settings: Settings): void;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Below the anchor and aligned to its left edge, flipped above it or pulled left to stay in the window. */
export function placeMenu(
  anchor: Box,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - menu.width - margin));
  const below = anchor.bottom + 4;
  const top = below + menu.height + margin <= viewport.height ? below : Math.max(margin, anchor.top - menu.height - 4);
  return { left, top };
}

/** The right-click language menu. Settings save as soon as a language changes. */
export function createLanguageMenu(deps: LanguageMenuDeps): LanguageMenu {
  const { doc } = deps;
  let current: { host: HTMLElement; picker: LanguagePicker; anchor: Element; cleanup: () => void } | null = null;

  function close(): void {
    if (!current) return;
    const { host, anchor, cleanup } = current;
    current = null;
    cleanup();
    host.remove();
    if (anchor.isConnected && 'focus' in anchor) (anchor as HTMLElement).focus();
  }

  function open(anchor: Element, id: string | null): void {
    close();
    const { host, shadow } = createHost(doc, MENU_TAG, MENU_CSS);
    host.setAttribute('data-theme', themeOf(anchor));
    const picker = createLanguagePicker(doc, deps.getSettings(), (patch) => void deps.setSettings(patch));
    const translate = h(doc, 'button', { class: 'translate', text: 'Translate', attrs: { type: 'button' } });
    translate.hidden = id === null;
    translate.addEventListener('click', () => {
      if (id) deps.onTranslate(id);
      close();
    });
    const panel = h(doc, 'div', { class: 'menu', attrs: { role: 'dialog', 'aria-label': 'Translation languages' } }, [
      h(doc, 'div', { class: 'title', text: 'Translation languages' }),
      picker.element,
      translate,
      h(doc, 'p', { class: 'note', text: 'Applies to every message. Each language downloads once, then works offline.' }),
    ]);
    shadow.append(panel);
    doc.documentElement.append(host);

    const view = doc.defaultView;
    const { left, top } = placeMenu(
      anchor.getBoundingClientRect(),
      { width: panel.offsetWidth || 280, height: panel.offsetHeight || 240 },
      { width: view?.innerWidth ?? 1024, height: view?.innerHeight ?? 768 },
    );
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    const onOutside = (event: Event) => {
      if (!event.composedPath().includes(host)) close();
    };
    doc.addEventListener('keydown', onKeydown, true);
    doc.addEventListener('mousedown', onOutside, true);
    doc.addEventListener('scroll', onOutside, true);
    current = {
      host,
      picker,
      anchor,
      cleanup: () => {
        doc.removeEventListener('keydown', onKeydown, true);
        doc.removeEventListener('mousedown', onOutside, true);
        doc.removeEventListener('scroll', onOutside, true);
      },
    };
    shadow.querySelector('select')?.focus();
  }

  return {
    open,
    close,
    isOpen: () => current !== null,
    update: (settings) => current?.picker.update(settings),
  };
}
