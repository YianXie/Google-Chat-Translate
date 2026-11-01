import { languageName, type LanguageCode } from './languages';
import type { EngineErrorCode } from './protocol';

export function languagePack(source: LanguageCode | undefined): string {
  return source ? `the ${languageName(source)} language pack` : 'the language pack';
}

/** What to tell the person about an engine error: a title and a line of detail. */
export function errorText(code: EngineErrorCode, source: LanguageCode | undefined, target: LanguageCode | undefined): [string, string] {
  switch (code) {
    case 'api-unavailable':
      return [
        "On-device translation isn't available in this browser",
        'It needs desktop Chrome 138 or later, and your administrator may have turned it off.',
      ];
    case 'detect-failed':
      return ["Couldn't detect the language", 'Right-click the translate button to choose the source language.'];
    case 'unsupported-pair':
      return [
        `Chrome can't translate ${source ? languageName(source) : 'this language'} → ${target ? languageName(target) : 'that language'} on-device`,
        'Right-click the translate button to pick other languages.',
      ];
    case 'download-failed':
      return [
        `Couldn't download ${languagePack(source)}`,
        "Check your internet connection and try again. Each language only downloads once, and you can get it ahead of time from the extension's toolbar button.",
      ];
    case 'translate-failed':
      return ['Translation failed', 'Click the translate button to try again.'];
    case 'engine-unreachable':
      return ['The extension was updated or reloaded', 'Refresh this page to keep translating.'];
  }
}
