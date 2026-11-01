/**
 * Everything that depends on Google Chat's markup. Chat's jsname attributes have
 * stayed the same since at least 2021; class names are only fallbacks.
 */
export const SELECTORS = {
  message: 'div[jsname="Ne3sFf"][data-id], [data-message-multiplat-item-id][data-id]',
  body: ['div[jsname="bgckF"]', '.DTp27d'],
  bubble: '[jsname="o7uNDd"]',
  editable: '[contenteditable="true"], [role="textbox"]',
  /** Inside a body: quoted replies, screen-reader helpers, code blocks, and controls. Inline code stays in its sentence. */
  skip: '[aria-hidden="true"], span[style*="display: none"], .cPjwNc, button, [role="tooltip"], pre, article[role="code"]',
  mention: '[data-user-mention-type]',
} as const;

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'OL', 'P', 'SECTION', 'TABLE', 'TR', 'UL',
]);
const HAS_LETTER = /\p{L}/u;

function elementOf(target: EventTarget | null): Element | null {
  if (!target || !('nodeType' in target)) return null;
  const node = target as Node;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** A message nested inside another one is a quoted reply. */
function outerMessage(message: Element): Element | null {
  return message.parentElement?.closest(SELECTORS.message) ?? null;
}

/** The message that `target` (an event target or node) sits in, ignoring the composer. */
export function findMessage(target: EventTarget | null): HTMLElement | null {
  const element = elementOf(target);
  if (!element || element.closest(SELECTORS.editable)) return null;
  let message = element.closest<HTMLElement>(SELECTORS.message);
  for (let outer = message && outerMessage(message); outer; outer = outerMessage(outer)) {
    message = outer as HTMLElement;
  }
  return message;
}

export function getMessageId(message: Element): string | null {
  return message.getAttribute('data-id');
}

function isOwnBody(body: Element, message: Element): boolean {
  if (body.closest(SELECTORS.message) !== message || body.closest(SELECTORS.editable)) return false;
  // An aria-hidden wrapper inside the message is a quoted reply.
  const hidden = body.closest('[aria-hidden="true"]');
  return !hidden || hidden === message || !message.contains(hidden);
}

export function getBody(message: Element): HTMLElement | null {
  for (const selector of SELECTORS.body) {
    for (const body of message.querySelectorAll<HTMLElement>(selector)) {
      if (isOwnBody(body, message)) return body;
    }
  }
  return null;
}

export function getBubble(message: Element): HTMLElement | null {
  return message.querySelector<HTMLElement>(SELECTORS.bubble) ?? getBody(message)?.parentElement ?? null;
}

/** The body of every on-screen message by id. One id can have several: Chat repeats a thread's first message in the thread panel. */
export function indexBodies(root: ParentNode): Map<string, HTMLElement[]> {
  const index = new Map<string, HTMLElement[]>();
  for (const message of root.querySelectorAll(SELECTORS.message)) {
    const id = getMessageId(message);
    const body = id !== null && !outerMessage(message) ? getBody(message) : null;
    if (id === null || !body) continue;
    const bodies = index.get(id);
    if (bodies) bodies.push(body);
    else index.set(id, [body]);
  }
  return index;
}

export function getBodies(root: ParentNode, id: string): HTMLElement[] {
  return indexBodies(root).get(id) ?? [];
}

/** The text a person wrote: mentions, links and emoji kept, quotes, code and Chat's controls left out. */
export function extractMessageText(body: Element): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.matches(SELECTORS.skip)) return;
    if (element.matches(SELECTORS.mention)) {
      const name = element.getAttribute('data-display-name');
      parts.push(name ? `@${name}` : (element.textContent ?? ''));
      return;
    }
    if (element.tagName === 'IMG') {
      parts.push(element.getAttribute('alt') ?? '');
      return;
    }
    if (element.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    const start = parts.length;
    element.childNodes.forEach(visit);
    // Only a block with something in it breaks the line: Chat puts empty divs inside sentences.
    if (BLOCK_TAGS.has(element.tagName) && parts.slice(start).join('').trim()) {
      parts.splice(start, 0, '\n');
      parts.push('\n');
    }
  };
  body.childNodes.forEach(visit);
  return parts
    .join('')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isTranslatable(text: string): boolean {
  return HAS_LETTER.test(text);
}
