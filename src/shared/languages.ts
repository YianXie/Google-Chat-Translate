/** Languages Chrome's on-device Translator supports (Chrome 138+). */
export const LANGUAGE_CODES = [
  'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi',
  'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'lt', 'mr', 'nl', 'no', 'pl', 'pt',
  'ro', 'ru', 'sk', 'sl', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi', 'zh', 'zh-Hant',
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const COMMON_LANGUAGES: readonly LanguageCode[] = [
  'en', 'es', 'zh', 'zh-Hant', 'ja', 'ko', 'fr', 'de', 'pt', 'hi', 'ar', 'ru', 'vi',
];

const NAME_OVERRIDES: Partial<Record<LanguageCode, string>> = {
  en: 'English (US)',
  zh: 'Chinese (Simplified)',
  'zh-Hant': 'Chinese (Traditional)',
};
const NATIVE_OVERRIDES: Partial<Record<LanguageCode, string>> = { zh: '简体中文' };
const ALIASES: Record<string, LanguageCode> = { iw: 'he', nb: 'no', nn: 'no' };
const TRADITIONAL_CHINESE_SUBTAGS = new Set(['hant', 'tw', 'hk', 'mo']);

const englishNames = new Intl.DisplayNames(['en'], { type: 'language' });

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

export function languageName(code: LanguageCode): string {
  return NAME_OVERRIDES[code] ?? englishNames.of(code) ?? code;
}

function nativeName(code: LanguageCode): string {
  const name = NATIVE_OVERRIDES[code] ?? new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
}

/** "Spanish · Español": the English name, plus the native name when it differs. */
export function languageLabel(code: LanguageCode): string {
  const native = nativeName(code);
  const sameAsEnglish = native.toLowerCase() === englishNames.of(code)?.toLowerCase();
  return sameAsEnglish ? languageName(code) : `${languageName(code)} · ${native}`;
}

/** Maps a BCP 47 tag (or a detector's code such as "iw") to a supported code. */
export function normalizeLanguage(tag: string): LanguageCode | null {
  const [primary = '', ...subtags] = tag.trim().toLowerCase().replace(/_/g, '-').split('-');
  if (primary === 'zh') {
    return subtags.some((subtag) => TRADITIONAL_CHINESE_SUBTAGS.has(subtag)) ? 'zh-Hant' : 'zh';
  }
  const code = ALIASES[primary] ?? primary;
  return isLanguageCode(code) ? code : null;
}

export function defaultTarget(uiLanguage: string): LanguageCode {
  return normalizeLanguage(uiLanguage) ?? 'en';
}
