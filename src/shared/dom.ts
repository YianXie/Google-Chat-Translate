interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
}

/** Builds an element without innerHTML: Chat enforces Trusted Types, and translations are untrusted text. */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  props: Props = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (props.class) element.className = props.class;
  if (props.text !== undefined) element.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

const ISOLATED_EVENTS = ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'contextmenu'];

/**
 * A host element with an open shadow root holding `css`. Content scripts have no
 * custom elements registry, so the tag stays an undefined element. Events stop at
 * the host so Chat's own handlers never act on clicks in our UI.
 */
export function createHost(doc: Document, tag: string, css: string): { host: HTMLElement; shadow: ShadowRoot } {
  const host = doc.createElement(tag);
  host.setAttribute('translate', 'no');
  for (const type of ISOLATED_EVENTS) host.addEventListener(type, (event) => event.stopPropagation());
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(h(doc, 'style', { text: css }));
  return { host, shadow };
}

/** True for light text colours such as "rgb(232, 234, 237)": the page is in a dark theme. */
export function isLightColor(color: string): boolean {
  const channels = color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);
  if (channels?.length !== 3) return false;
  const [red = 0, green = 0, blue = 0] = channels;
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.6;
}

/** Chat can be dark while the OS is light, so read the theme off Chat's own text colour. */
export function themeOf(element: Element): 'dark' | 'light' {
  const color = element.ownerDocument.defaultView?.getComputedStyle(element).color ?? '';
  return isLightColor(color) ? 'dark' : 'light';
}
