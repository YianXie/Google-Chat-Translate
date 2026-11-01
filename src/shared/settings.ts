import { defaultTarget, isLanguageCode, type LanguageCode } from './languages';

export type SourceSetting = LanguageCode | 'auto';

export interface Settings {
  source: SourceSetting;
  target: LanguageCode;
}

const STORAGE_KEY = 'settings';

function sanitize(value: unknown): Settings {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    source: stored.source === 'auto' || isLanguageCode(stored.source) ? stored.source : 'auto',
    target: isLanguageCode(stored.target) ? stored.target : defaultTarget(chrome.i18n.getUILanguage()),
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return sanitize(stored[STORAGE_KEY]);
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

/** Calls `listener` whenever the settings change in any tab or the popup. Returns an unsubscribe function. */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const change = changes[STORAGE_KEY];
    if (area === 'sync' && change) listener(sanitize(change.newValue));
  };
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
}
