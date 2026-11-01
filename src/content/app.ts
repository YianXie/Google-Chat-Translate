import { request } from '../shared/engine-client';
import { getSettings, setSettings, watchSettings } from '../shared/settings';
import { getMessageId } from './chat-dom';
import { createController } from './controller';
import { OVERLAY_TAG, createHoverButton } from './hover-button';
import { MENU_TAG, createLanguageMenu } from './language-menu';
import { BLOCK_TAG } from './translation-block';

const RECONCILE_DELAY_MS = 100;
const OWN_TAGS = new Set([BLOCK_TAG, OVERLAY_TAG, MENU_TAG]);

function isOwnNode(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && OWN_TAGS.has((node as Element).localName);
}

/** Mutations that only add or remove our own elements don't need a reconcile pass. */
function isOwnMutation(record: MutationRecord): boolean {
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return record.type === 'childList' && nodes.length > 0 && nodes.every(isOwnNode);
}

/** Wires the content script into one Chat frame. Returns a function that undoes it. */
export async function startContentScript(doc: Document = document): Promise<() => void> {
  let settings = await getSettings();

  const controller = createController({
    doc,
    getSettings: () => settings,
    translate: (text, current, onProgress) =>
      request({ type: 'translate', text, source: current.source, target: current.target }, { onProgress }),
    onMenu: (anchor, id) => menu.open(anchor, id),
  });
  const menu = createLanguageMenu({
    doc,
    getSettings: () => settings,
    setSettings,
    onTranslate: (id) => controller.show(id),
  });
  const hover = createHoverButton({
    doc,
    onClick: (message) => controller.toggle(message),
    onContextMenu: (message, anchor) => menu.open(anchor, getMessageId(message)),
  });
  const unwatch = watchSettings((next) => {
    settings = next;
    menu.update(next);
    controller.refresh();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      controller.reconcile();
    }, RECONCILE_DELAY_MS);
  };
  const observer = new MutationObserver((records) => {
    if (records.some((record) => !isOwnMutation(record))) schedule();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  const view = doc.defaultView;
  view?.addEventListener('popstate', schedule);
  view?.addEventListener('hashchange', schedule);

  return () => {
    observer.disconnect();
    clearTimeout(timer);
    view?.removeEventListener('popstate', schedule);
    view?.removeEventListener('hashchange', schedule);
    unwatch();
    menu.close();
    hover.destroy();
  };
}
