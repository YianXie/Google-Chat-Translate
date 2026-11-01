import { describe, expect, it } from 'vitest';
import { getSettings, setSettings, watchSettings, type Settings } from '../src/shared/settings';
import { flush, installFakeChrome } from './fakes/chrome';

describe('settings', () => {
  it('defaults to auto-detect, translating into the browser UI language', async () => {
    installFakeChrome({ uiLanguage: 'es-419' });
    expect(await getSettings()).toEqual({ source: 'auto', target: 'es' });
  });

  it('falls back to defaults for stored values it does not recognise', async () => {
    const { syncData } = installFakeChrome({ uiLanguage: 'en-US' });
    syncData.settings = { source: 'klingon', target: 42 };
    expect(await getSettings()).toEqual({ source: 'auto', target: 'en' });
  });

  it('merges and persists partial changes', async () => {
    installFakeChrome();
    await setSettings({ target: 'ja' });
    await setSettings({ source: 'es' });
    expect(await getSettings()).toEqual({ source: 'es', target: 'ja' });
  });

  it('tells watchers about changes until they unsubscribe', async () => {
    installFakeChrome();
    const seen: Settings[] = [];
    const stop = watchSettings((settings) => seen.push(settings));

    await setSettings({ target: 'fr' });
    await flush();
    stop();
    await setSettings({ target: 'de' });
    await flush();

    expect(seen).toEqual([{ source: 'auto', target: 'fr' }]);
  });

  it('ignores changes to other storage keys', async () => {
    const { chrome } = installFakeChrome();
    const seen: Settings[] = [];
    watchSettings((settings) => seen.push(settings));

    await chrome.storage.sync.set({ somethingElse: 1 });
    await flush();

    expect(seen).toEqual([]);
  });
});
