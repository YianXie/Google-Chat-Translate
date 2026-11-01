import { h } from '../shared/dom';
import { request } from '../shared/engine-client';
import { errorText } from '../shared/error-text';
import { ALL_LANGUAGES, PICKER_CSS, createLanguagePicker } from '../shared/language-picker';
import { languageLabel, languageName, type LanguageCode } from '../shared/languages';
import { EngineError, type StatusResult } from '../shared/protocol';
import { getSettings, setSettings, watchSettings } from '../shared/settings';

type DownloadRequest = { type: 'download'; source: LanguageCode; target: LanguageCode } | { type: 'download-detector' };

const DETECTOR_TEXT: Record<StatusResult['detector'], string> = {
  available: 'Auto-detect: ready offline',
  downloadable: 'Auto-detect: more accurate with its model',
  downloading: 'Auto-detect: more accurate with its model',
  unavailable: "Auto-detect: uses Chrome's basic detector",
};

/** The toolbar menu: the same language settings as the right-click menu, plus offline downloads. */
export async function startPopup(doc: Document = document): Promise<() => void> {
  const root = doc.querySelector('#app');
  if (!root) throw new Error('popup.html is missing #app');
  let settings = await getSettings();
  let busy = false;
  let generation = 0;

  const picker = createLanguagePicker(doc, settings, (patch) => void setSettings(patch));
  const banner = h(doc, 'p', { class: 'banner' });
  const heading = h(doc, 'h2', { class: 'heading' });
  const ready = h(doc, 'p', { class: 'ready' });
  const pack = h(doc, 'select', { class: 'pack', attrs: { 'aria-label': 'Language to download' } });
  const download = h(doc, 'button', { class: 'download', text: 'Download', attrs: { type: 'button' } });
  const bar = h(doc, 'div', { class: 'bar' });
  const progress = h(doc, 'div', { class: 'progress' }, [bar]);
  const message = h(doc, 'p', { class: 'message' });
  const detector = h(doc, 'span', { class: 'detector' });
  const detectorDownload = h(doc, 'button', { class: 'download-detector', text: 'Download', attrs: { type: 'button' } });
  const offline = h(doc, 'section', { class: 'offline' }, [
    heading,
    ready,
    h(doc, 'div', { class: 'row' }, [pack, download]),
    progress,
    message,
    h(doc, 'div', { class: 'row' }, [detector, detectorDownload]),
    h(doc, 'p', {
      class: 'hint',
      text: 'Each language pack is about 60 MB and is kept by Chrome. Keep this menu open until a download finishes. Translating a new language also downloads its pack automatically.',
    }),
  ]);
  const status = h(doc, 'div', { class: 'status' }, [banner, offline]);
  for (const element of [banner, progress, message, detectorDownload]) element.hidden = true;

  doc.head.append(h(doc, 'style', { text: PICKER_CSS }));
  root.append(h(doc, 'h1', { text: 'Google Chat Translate' }), picker.element, status);

  function syncButtons(): void {
    pack.disabled = busy;
    download.disabled = busy || pack.options.length === 0;
    detectorDownload.disabled = busy;
  }

  function renderPacks(readyCodes: LanguageCode[]): void {
    const previous = pack.value;
    const missing = ALL_LANGUAGES.filter((code) => code !== settings.target && !readyCodes.includes(code));
    pack.replaceChildren(...missing.map((code) => h(doc, 'option', { text: languageLabel(code), attrs: { value: code } })));
    const wanted = [previous, settings.source].find((code) => missing.includes(code as LanguageCode));
    if (wanted) pack.value = wanted;
  }

  function renderStatus(result: StatusResult): void {
    banner.hidden = result.supported;
    offline.hidden = !result.supported;
    if (!result.supported) {
      banner.textContent = errorText('api-unavailable', undefined, undefined).join('. ');
      return;
    }
    heading.textContent = `Offline languages into ${languageName(settings.target)}`;
    ready.textContent = result.ready.length > 0 ? `Ready: ${result.ready.map(languageName).join(', ')}` : 'None downloaded yet';
    renderPacks(result.ready);
    detector.textContent = DETECTOR_TEXT[result.detector];
    detectorDownload.hidden = result.detector !== 'downloadable' && result.detector !== 'downloading';
    syncButtons();
  }

  function renderFailure(error: unknown): void {
    const [title] = errorText(error instanceof EngineError ? error.code : 'engine-unreachable', undefined, undefined);
    banner.textContent = `${title}. Close this menu and open it again.`;
    banner.hidden = false;
    offline.hidden = true;
  }

  async function refresh(): Promise<void> {
    const mine = ++generation;
    let result: StatusResult | null = null;
    let failure: unknown;
    try {
      result = await request({ type: 'status', target: settings.target });
    } catch (error) {
      failure = error;
    }
    if (mine !== generation) return;
    if (result) renderStatus(result);
    else renderFailure(failure);
    status.setAttribute('data-loaded', 'true');
  }

  async function runDownload(downloadRequest: DownloadRequest): Promise<void> {
    busy = true;
    syncButtons();
    message.hidden = true;
    progress.hidden = false;
    bar.style.width = '0%';
    try {
      await request(downloadRequest, {
        onProgress: ({ loaded }) => {
          if (loaded !== null) bar.style.width = `${Math.round(loaded * 100)}%`;
        },
      });
    } catch (error) {
      const engineError = error instanceof EngineError ? error : new EngineError('download-failed');
      message.textContent = errorText(engineError.code, engineError.source, engineError.target).join('. ');
      message.hidden = false;
    }
    busy = false;
    progress.hidden = true;
    syncButtons();
    await refresh();
  }

  download.addEventListener('click', () => {
    void runDownload({ type: 'download', source: pack.value as LanguageCode, target: settings.target });
  });
  detectorDownload.addEventListener('click', () => {
    void runDownload({ type: 'download-detector' });
  });
  const unwatch = watchSettings((next) => {
    settings = next;
    picker.update(next);
    void refresh();
  });

  void refresh();

  return () => {
    unwatch();
    root.replaceChildren();
  };
}
