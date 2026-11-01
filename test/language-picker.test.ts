import { describe, expect, it, vi } from 'vitest';
import { createLanguagePicker } from '../src/shared/language-picker';

function selects(element: HTMLElement) {
  const source = element.querySelector<HTMLSelectElement>('select[name="source"]');
  const target = element.querySelector<HTMLSelectElement>('select[name="target"]');
  if (!source || !target) throw new Error('picker is missing a select');
  return { source, target };
}

describe('createLanguagePicker', () => {
  it('shows the current languages', () => {
    const picker = createLanguagePicker(document, { source: 'auto', target: 'zh-Hant' }, () => {});
    const { source, target } = selects(picker.element);

    expect(source.value).toBe('auto');
    expect(target.value).toBe('zh-Hant');
  });

  it('offers Auto-detect as a source only', () => {
    const { source, target } = selects(createLanguagePicker(document, { source: 'auto', target: 'en' }, () => {}).element);

    expect(source.options[0]?.textContent).toBe('Auto-detect');
    expect([...target.options].some((option) => option.value === 'auto')).toBe(false);
  });

  it('lists common languages first, then every language alphabetically', () => {
    const { target } = selects(createLanguagePicker(document, { source: 'auto', target: 'en' }, () => {}).element);
    const [common, all] = [...target.querySelectorAll('optgroup')];

    expect(common?.label).toBe('Common');
    expect(common?.querySelector('option')?.textContent).toBe('English (US)');
    expect(all?.label).toBe('All languages');
    const names = [...(all?.querySelectorAll('option') ?? [])].map((option) => option.textContent ?? '');
    expect(names).toHaveLength(39);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('reports each change', () => {
    const onChange = vi.fn();
    const { source, target } = selects(createLanguagePicker(document, { source: 'auto', target: 'en' }, onChange).element);

    source.value = 'es';
    source.dispatchEvent(new Event('change'));
    target.value = 'ja';
    target.dispatchEvent(new Event('change'));

    expect(onChange.mock.calls).toEqual([[{ source: 'es' }], [{ target: 'ja' }]]);
  });

  it('shows changes made elsewhere', () => {
    const picker = createLanguagePicker(document, { source: 'auto', target: 'en' }, () => {});
    picker.update({ source: 'fr', target: 'de' });

    expect(selects(picker.element)).toMatchObject({ source: { value: 'fr' }, target: { value: 'de' } });
  });
});
