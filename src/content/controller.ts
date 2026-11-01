import { EngineError, type DownloadProgress, type TranslateResult } from '../shared/protocol';
import type { Settings } from '../shared/settings';
import { extractMessageText, getBodies, getMessageId, indexBodies, isTranslatable } from './chat-dom';
import { BLOCK_TAG, createBlock, matchBody, renderBlock, type BlockView } from './translation-block';

export interface ControllerDeps {
  doc: Document;
  getSettings: () => Settings;
  translate: (text: string, settings: Settings, onProgress: (progress: DownloadProgress) => void) => Promise<TranslateResult>;
  onMenu: (anchor: Element, id: string) => void;
}

export interface Controller {
  toggle(message: Element): void;
  show(id: string): void;
  hide(id: string): void;
  isOpen(id: string): boolean;
  /** Puts blocks back after Chat re-renders, translates edited messages again, and removes strays. */
  reconcile(): void;
  /** Translates open messages again with the current settings. */
  refresh(): void;
}

interface MessageState {
  open: boolean;
  text: string;
  /** The settings and text this state's translation belongs to. */
  key: string;
  view: BlockView;
}

function keyOf(settings: Settings, text: string): string {
  return `${settings.source}>${settings.target}\n${text}`;
}

function errorView(error: unknown, settings: Settings): BlockView {
  const engineError = error instanceof EngineError ? error : new EngineError('translate-failed');
  return {
    state: 'error',
    code: engineError.code,
    source: engineError.source ?? (settings.source === 'auto' ? undefined : settings.source),
    target: engineError.target ?? settings.target,
  };
}

/** Per-message translation state, keyed by Chat's message id so it survives re-renders. */
export function createController(deps: ControllerDeps): Controller {
  const { doc } = deps;
  const states = new Map<string, MessageState>();

  function blocksOf(id: string): HTMLElement[] {
    return [...doc.querySelectorAll<HTMLElement>(BLOCK_TAG)].filter((block) => block.getAttribute('data-gct-id') === id);
  }

  /** Gives every on-screen copy of the message an up-to-date block right after its body. */
  function attach(id: string, state: MessageState, bodies = getBodies(doc, id)): void {
    for (const body of bodies) {
      let block = body.nextElementSibling as HTMLElement | null;
      if (block?.localName !== BLOCK_TAG || block.getAttribute('data-gct-id') !== id) {
        block = createBlock(doc, id, { onHide: () => hide(id), onMenu: (anchor) => deps.onMenu(anchor, id) });
        matchBody(block, body);
        body.after(block);
      }
      renderBlock(block, state.view);
    }
  }

  function update(id: string, state: MessageState, view: BlockView): void {
    if (states.get(id) !== state) return; // A newer request replaced this one.
    state.view = view;
    if (state.open) for (const block of blocksOf(id)) renderBlock(block, view);
  }

  function translate(id: string, text: string): void {
    const settings = deps.getSettings();
    const state: MessageState = { open: true, text, key: keyOf(settings, text), view: { state: 'translating' } };
    states.set(id, state);
    attach(id, state);
    deps
      .translate(text, settings, (progress) =>
        update(id, state, { state: 'downloading', loaded: progress.loaded, source: progress.source, target: settings.target }),
      )
      .then(
        (result) => update(id, state, { state: 'done', result }),
        (error: unknown) => update(id, state, errorView(error, settings)),
      );
  }

  function show(id: string): void {
    const [body] = getBodies(doc, id);
    if (!body) return;
    const text = extractMessageText(body);
    if (!isTranslatable(text)) return;
    const state = states.get(id);
    if (state && state.key === keyOf(deps.getSettings(), text) && state.view.state !== 'error') {
      state.open = true;
      attach(id, state);
    } else {
      translate(id, text);
    }
  }

  function hide(id: string): void {
    const state = states.get(id);
    if (state) state.open = false;
    for (const block of blocksOf(id)) block.remove();
  }

  function reconcile(): void {
    // This runs on every burst of mutations on a busy page, so it scans for messages once at most.
    const blocks = doc.querySelectorAll<HTMLElement>(BLOCK_TAG);
    if (blocks.length === 0 && ![...states.values()].some((state) => state.open)) return;
    const bodiesById = indexBodies(doc);

    for (const block of blocks) {
      const id = block.getAttribute('data-gct-id') ?? '';
      const previous = block.previousElementSibling as HTMLElement | null;
      if (!states.get(id)?.open || !previous || !bodiesById.get(id)?.includes(previous)) block.remove();
    }

    for (const [id, state] of states) {
      if (!state.open) continue;
      const bodies = bodiesById.get(id);
      const body = bodies?.[0];
      if (!bodies || !body) continue; // Off screen for now; the block comes back with the message.
      const text = extractMessageText(body);
      if (text === state.text) attach(id, state, bodies);
      else if (isTranslatable(text)) translate(id, text);
      else hide(id);
    }
  }

  function refresh(): void {
    const settings = deps.getSettings();
    for (const [id, state] of states) {
      if (state.open && state.key !== keyOf(settings, state.text)) translate(id, state.text);
    }
  }

  return {
    toggle(message) {
      const id = getMessageId(message);
      if (!id) return;
      if (states.get(id)?.open) hide(id);
      else show(id);
    },
    show,
    hide,
    isOpen: (id) => states.get(id)?.open ?? false,
    reconcile,
    refresh,
  };
}
