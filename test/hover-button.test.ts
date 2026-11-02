import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_TAG,
  createHoverButton,
  placeButton,
  type HoverButton,
  type HoverButtonDeps,
  type Rect,
} from '../src/content/hover-button';

const fixture = readFileSync('test/fixtures/chat.html', 'utf8');

function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

const incoming = { bubble: rect(100, 200, 180, 20), row: rect(40, 190, 600, 40) };

let onClick: ReturnType<typeof vi.fn<HoverButtonDeps['onClick']>>;
let onContextMenu: ReturnType<typeof vi.fn<HoverButtonDeps['onContextMenu']>>;
let hover: HoverButton;

function start(measure: HoverButtonDeps['measure'] = () => incoming): void {
  hover = createHoverButton({ doc: document, onClick, onContextMenu, measure, hideDelayMs: 300 });
}

function button(): HTMLButtonElement {
  const element = document.querySelector(OVERLAY_TAG)?.shadowRoot?.querySelector('button');
  if (!element) throw new Error('no overlay button');
  return element;
}

function message(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[role="main"] [data-id="${id}"]`);
  if (!element) throw new Error(`no message ${id}`);
  return element;
}

function hoverOver(target: Element | null): void {
  target?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
}

const bodyOf = (id: string) => message(id).querySelector('[jsname="bgckF"]');

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = fixture;
  onClick = vi.fn();
  onContextMenu = vi.fn();
  start();
});

afterEach(() => {
  hover.destroy();
  vi.useRealTimers();
});

describe('hover button', () => {
  it('appears beside the message under the pointer', () => {
    hoverOver(bodyOf('msg-es'));

    expect(button().hidden).toBe(false);
    expect(button().style.left).toBe('286px');
    expect(button().style.top).toBe('197px');
  });

  it('stays hidden over messages with no words', () => {
    hoverOver(bodyOf('msg-emoji'));
    expect(button().hidden).toBe(true);
  });

  it('ignores the message composer', () => {
    hoverOver(document.querySelector('.composer [jsname="bgckF"]'));
    expect(button().hidden).toBe(true);
  });

  it('translates its message when clicked', () => {
    hoverOver(bodyOf('msg-es'));
    button().click();
    expect(onClick).toHaveBeenCalledWith(message('msg-es'));
  });

  it('opens the language menu on right-click instead of the browser menu', () => {
    hoverOver(bodyOf('msg-es'));
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true });

    button().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onContextMenu).toHaveBeenCalledWith(message('msg-es'), button());
  });

  it('hides shortly after the pointer leaves the message', () => {
    hoverOver(bodyOf('msg-es'));
    hoverOver(document.body);

    vi.advanceTimersByTime(299);
    expect(button().hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(button().hidden).toBe(true);
  });

  it('stays while the pointer moves onto it', () => {
    hoverOver(bodyOf('msg-es'));
    hoverOver(document.body);
    hoverOver(button());

    vi.advanceTimersByTime(1000);
    expect(button().hidden).toBe(false);
  });

  it('follows the pointer to another message', () => {
    hoverOver(bodyOf('msg-es'));
    hoverOver(bodyOf('msg-rich'));
    button().click();

    expect(onClick).toHaveBeenCalledWith(message('msg-rich'));
  });

  it('moves with the message when the chat scrolls', () => {
    hover.destroy();
    start(vi.fn<NonNullable<HoverButtonDeps['measure']>>().mockReturnValueOnce(incoming).mockReturnValue({
      bubble: rect(100, 150, 180, 20),
      row: rect(40, 140, 600, 40),
    }));
    hoverOver(bodyOf('msg-es'));

    document.querySelector('[jsname="iyUusd"]')?.dispatchEvent(new Event('scroll'));

    expect(button().style.top).toBe('147px');
  });

  it('removes itself on destroy', () => {
    hover.destroy();
    expect(document.querySelector(OVERLAY_TAG)).toBeNull();
  });
});

describe('placeButton', () => {
  const row = rect(40, 190, 600, 100);

  it('sits right of a left-aligned bubble, from someone else', () => {
    expect(placeButton(rect(100, 200, 180, 20), row, 26)).toEqual({ left: 286, top: 197 });
  });

  it('sits left of a right-aligned bubble, your own', () => {
    expect(placeButton(rect(400, 200, 200, 20), row, 26)).toEqual({ left: 368, top: 197 });
  });

  it('centres on the whole bubble, however tall', () => {
    expect(placeButton(rect(100, 200, 180, 80), row, 26).top).toBe(227);
  });

  it.each([
    ['left-aligned', rect(100, 200, 180, 20)],
    ['right-aligned', rect(400, 200, 200, 20)],
  ])('never overlaps a %s bubble', (_name, bubble) => {
    const { left } = placeButton(bubble, row, 26);
    expect(left + 26 <= bubble.left || left >= bubble.right).toBe(true);
  });
});
