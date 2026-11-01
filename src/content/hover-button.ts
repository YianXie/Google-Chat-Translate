import { createHost, h, themeOf } from '../shared/dom';
import { extractMessageText, findMessage, getBody, isTranslatable } from './chat-dom';
import { OVERLAY_CSS } from './styles';

export const OVERLAY_TAG = 'gct-overlay';
const SIZE = 26;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Measured {
  /** The last line of the message text. */
  anchor: Rect;
  /** The message row; the button stays inside it so moving onto the button keeps the hover. */
  row: Rect;
}

export interface HoverButtonDeps {
  doc: Document;
  onClick(message: HTMLElement): void;
  onContextMenu(message: HTMLElement, anchor: HTMLElement): void;
  measure?: (message: HTMLElement) => Measured | null;
  hideDelayMs?: number;
}

export interface HoverButton {
  destroy(): void;
}

export function placeButton(anchor: Rect, row: Rect, size: number, gap = 6): { left: number; top: number } {
  return {
    left: Math.min(anchor.right + gap, row.right - size - 4),
    top: anchor.top + (anchor.height - size) / 2,
  };
}

function measureMessage(message: HTMLElement): Measured | null {
  const body = getBody(message);
  if (!body) return null;
  const range = message.ownerDocument.createRange();
  range.selectNodeContents(body);
  const lines = [...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0);
  return { anchor: lines.at(-1) ?? body.getBoundingClientRect(), row: message.getBoundingClientRect() };
}

function hasWords(message: HTMLElement): boolean {
  const body = getBody(message);
  return !!body && isTranslatable(extractMessageText(body));
}

/** One floating 文A button per frame that follows the pointer from message to message. */
export function createHoverButton(deps: HoverButtonDeps): HoverButton {
  const { doc, measure = measureMessage, hideDelayMs = 300 } = deps;
  const { host, shadow } = createHost(doc, OVERLAY_TAG, OVERLAY_CSS);
  const button = h(doc, 'button', {
    class: 'translate',
    text: '文A',
    attrs: { type: 'button', 'aria-label': 'Translate message', title: 'Translate · Right-click for languages' },
  });
  button.hidden = true;
  shadow.append(button);
  doc.documentElement.append(host);

  let current: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function hide(): void {
    clearTimeout(hideTimer);
    current = null;
    button.hidden = true;
  }

  function scheduleHide(): void {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, hideDelayMs);
  }

  function position(): void {
    const measured = current?.isConnected ? measure(current) : null;
    if (!measured) return hide();
    const { left, top } = placeButton(measured.anchor, measured.row, SIZE);
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  }

  function show(message: HTMLElement): void {
    clearTimeout(hideTimer);
    if (message !== current) {
      current = message;
      host.setAttribute('data-theme', themeOf(getBody(message) ?? message));
    }
    position();
    if (current) button.hidden = false;
  }

  const onMouseOver = (event: Event) => {
    // Events from inside our shadow root arrive retargeted to the host.
    if (event.target === host) return clearTimeout(hideTimer);
    const message = findMessage(event.target);
    if (message && (message === current || hasWords(message))) show(message);
    else if (current) scheduleHide();
  };
  const onScroll = () => {
    if (current) position();
  };

  button.addEventListener('click', () => {
    if (current) deps.onClick(current);
  });
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (current) deps.onContextMenu(current, button);
  });
  doc.addEventListener('mouseover', onMouseOver, { capture: true, passive: true });
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  doc.defaultView?.addEventListener('resize', onScroll);
  doc.documentElement.addEventListener('mouseleave', scheduleHide);

  return {
    destroy() {
      hide();
      doc.removeEventListener('mouseover', onMouseOver, { capture: true });
      doc.removeEventListener('scroll', onScroll, { capture: true });
      doc.defaultView?.removeEventListener('resize', onScroll);
      doc.documentElement.removeEventListener('mouseleave', scheduleHide);
      host.remove();
    },
  };
}
