import { createHost, h } from '../shared/dom';
import { errorText, languagePack } from '../shared/error-text';
import { languageName, type LanguageCode } from '../shared/languages';
import type { EngineErrorCode, TranslateResult } from '../shared/protocol';
import { BLOCK_CSS } from './styles';

export const BLOCK_TAG = 'gct-translation';

export type BlockView =
  | { state: 'translating' }
  | { state: 'downloading'; loaded: number | null; source?: LanguageCode; target: LanguageCode }
  | { state: 'done'; result: TranslateResult }
  | { state: 'error'; code: EngineErrorCode; source?: LanguageCode; target: LanguageCode };

export interface BlockHandlers {
  onHide(): void;
  onMenu(anchor: Element): void;
}

/** The block that shows a message's translation, inserted right after the message body. */
export function createBlock(doc: Document, id: string, handlers: BlockHandlers): HTMLElement {
  const { host, shadow } = createHost(doc, BLOCK_TAG, BLOCK_CSS);
  host.setAttribute('data-gct-id', id);

  const toggle = h(doc, 'button', {
    class: 'toggle',
    text: '文A',
    attrs: { type: 'button', title: 'Hide translation · Right-click for languages', 'aria-label': 'Hide translation' },
  });
  const hide = h(doc, 'button', { class: 'hide', text: 'Hide', attrs: { type: 'button' } });
  const header = h(doc, 'div', { class: 'header' }, [toggle, h(doc, 'span', { class: 'label' }), hide]);
  const progress = h(doc, 'div', { class: 'progress', attrs: { hidden: '' } }, [h(doc, 'div', { class: 'bar' })]);
  shadow.append(h(doc, 'div', { class: 'block' }, [header, progress, h(doc, 'div', { class: 'text' })]));

  toggle.addEventListener('click', () => handlers.onHide());
  hide.addEventListener('click', () => handlers.onHide());
  header.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    handlers.onMenu(toggle);
  });
  return host;
}

/** Chat sets the text size and inset on the message body itself, so the block copies them to line up with it. */
export function matchBody(host: HTMLElement, body: HTMLElement): void {
  const style = body.ownerDocument.defaultView?.getComputedStyle(body);
  if (!style) return;
  host.style.fontSize = style.fontSize;
  host.style.lineHeight = style.lineHeight;
  host.style.paddingLeft = style.paddingLeft;
  host.style.paddingRight = style.paddingRight;
  host.style.paddingBottom = style.paddingBottom;
}

/** Assigning textContent replaces the text node even if nothing changed, which would collapse a selection in it. */
function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

export function renderBlock(host: HTMLElement, view: BlockView): void {
  const shadow = host.shadowRoot;
  const label = shadow?.querySelector<HTMLElement>('.label');
  const text = shadow?.querySelector<HTMLElement>('.text');
  const progress = shadow?.querySelector<HTMLElement>('.progress');
  const bar = shadow?.querySelector<HTMLElement>('.bar');
  if (!label || !text || !progress || !bar) return;

  let title = '';
  let detail = '';
  let lang: LanguageCode | null = null;
  let loaded: number | null = null;
  switch (view.state) {
    case 'translating':
      title = 'Translating…';
      break;
    case 'downloading':
      if (view.loaded === null) {
        title = "Downloading Chrome's translation engine…";
        detail = 'This happens once (about 20 MB). After that, translation works offline.';
      } else {
        title = `Downloading ${languagePack(view.source)}… ${Math.round(view.loaded * 100)}%`;
        detail = 'This happens once per language (about 60 MB). After that, translation works offline.';
        loaded = view.loaded;
      }
      break;
    case 'done':
      if (view.result.kind === 'translated') {
        title = `${languageName(view.result.source)} → ${languageName(view.result.target)}`;
        detail = view.result.text;
        lang = view.result.target;
      } else {
        title = `Already in ${languageName(view.result.source)}`;
      }
      break;
    case 'error':
      [title, detail] = errorText(view.code, view.source, view.target);
      break;
  }

  host.setAttribute('data-state', view.state);
  setText(label, title);
  setText(text, detail);
  text.hidden = detail === '';
  if (lang) text.setAttribute('lang', lang);
  else text.removeAttribute('lang');
  progress.hidden = loaded === null;
  bar.style.width = `${Math.round((loaded ?? 0) * 100)}%`;
}
