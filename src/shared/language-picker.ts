import { h } from './dom';
import { COMMON_LANGUAGES, LANGUAGE_CODES, languageLabel, type LanguageCode } from './languages';
import type { Settings, SourceSetting } from './settings';

export interface LanguagePicker {
  element: HTMLElement;
  update(settings: Settings): void;
}

/** Shared by the in-page menu and the popup; the container defines the --gct-* colours. */
export const PICKER_CSS = `
.picker { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.field { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; font-size: 12px; }
.field > span { opacity: 0.75; }
.field select {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 14px;
  padding: 6px 8px;
  border: 1px solid var(--gct-border);
  border-radius: 6px;
  background: var(--gct-field);
  color: inherit;
}
`;

export const ALL_LANGUAGES = [...LANGUAGE_CODES].sort((a, b) => languageLabel(a).localeCompare(languageLabel(b), 'en'));

function options(doc: Document, codes: readonly LanguageCode[]): HTMLOptionElement[] {
  return codes.map((code) => h(doc, 'option', { text: languageLabel(code), attrs: { value: code } }));
}

function languageSelect(doc: Document, name: 'source' | 'target'): HTMLSelectElement {
  const auto = name === 'source' ? [h(doc, 'option', { text: 'Auto-detect', attrs: { value: 'auto' } })] : [];
  return h(doc, 'select', { attrs: { name } }, [
    ...auto,
    h(doc, 'optgroup', { attrs: { label: 'Common' } }, options(doc, COMMON_LANGUAGES)),
    h(doc, 'optgroup', { attrs: { label: 'All languages' } }, options(doc, ALL_LANGUAGES)),
  ]);
}

/** "Translate from" and "Translate to" selects. */
export function createLanguagePicker(
  doc: Document,
  settings: Settings,
  onChange: (patch: Partial<Settings>) => void,
): LanguagePicker {
  const source = languageSelect(doc, 'source');
  const target = languageSelect(doc, 'target');
  source.addEventListener('change', () => onChange({ source: source.value as SourceSetting }));
  target.addEventListener('change', () => onChange({ target: target.value as LanguageCode }));

  const field = (label: string, select: HTMLSelectElement) =>
    h(doc, 'label', { class: 'field' }, [h(doc, 'span', { text: label }), select]);
  const element = h(doc, 'div', { class: 'picker' }, [field('Translate from', source), field('Translate to', target)]);
  const update = (next: Settings) => {
    source.value = next.source;
    target.value = next.target;
  };
  update(settings);
  return { element, update };
}
