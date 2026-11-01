import { describe, expect, it } from 'vitest';
import {
  COMMON_LANGUAGES,
  LANGUAGE_CODES,
  defaultTarget,
  isLanguageCode,
  languageLabel,
  languageName,
  normalizeLanguage,
} from '../src/shared/languages';

describe('LANGUAGE_CODES', () => {
  it('lists the 39 languages Chrome translates on-device', () => {
    expect(LANGUAGE_CODES).toHaveLength(39);
    expect(LANGUAGE_CODES).toEqual(expect.arrayContaining(['en', 'es', 'zh', 'zh-Hant', 'ja', 'he', 'no']));
  });

  it('only puts supported languages in the common group', () => {
    expect(COMMON_LANGUAGES.every(isLanguageCode)).toBe(true);
  });
});

describe('languageName', () => {
  it('labels English as English (US)', () => {
    expect(languageName('en')).toBe('English (US)');
  });

  it('spells out both Chinese scripts', () => {
    expect(languageName('zh')).toBe('Chinese (Simplified)');
    expect(languageName('zh-Hant')).toBe('Chinese (Traditional)');
  });

  it('uses the English display name for other languages', () => {
    expect(languageName('es')).toBe('Spanish');
    expect(languageName('ja')).toBe('Japanese');
  });
});

describe('languageLabel', () => {
  it('adds the native name when it differs', () => {
    expect(languageLabel('es')).toBe('Spanish · Español');
    expect(languageLabel('zh')).toBe('Chinese (Simplified) · 简体中文');
    expect(languageLabel('zh-Hant')).toBe('Chinese (Traditional) · 繁體中文');
  });

  it('shows one name when the native name is the English one', () => {
    expect(languageLabel('en')).toBe('English (US)');
  });
});

describe('normalizeLanguage', () => {
  it.each([
    ['en-US', 'en'],
    ['ES', 'es'],
    ['pt-BR', 'pt'],
    ['iw', 'he'],
    ['nb', 'no'],
    ['nn', 'no'],
    ['zh', 'zh'],
    ['zh-CN', 'zh'],
    ['zh-Hans', 'zh'],
    ['zh_TW', 'zh-Hant'],
    ['zh-HK', 'zh-Hant'],
    ['zh-Hant', 'zh-Hant'],
    ['zh-Hant-TW', 'zh-Hant'],
  ])('maps %s to %s', (tag, expected) => {
    expect(normalizeLanguage(tag)).toBe(expected);
  });

  it.each(['und', 'la', 'fil', ''])('rejects unsupported tag %j', (tag) => {
    expect(normalizeLanguage(tag)).toBeNull();
  });
});

describe('defaultTarget', () => {
  it('follows the browser UI language', () => {
    expect(defaultTarget('en-US')).toBe('en');
    expect(defaultTarget('es-419')).toBe('es');
    expect(defaultTarget('zh-TW')).toBe('zh-Hant');
  });

  it('falls back to English for UI languages Chrome cannot translate into', () => {
    expect(defaultTarget('fil')).toBe('en');
  });
});
