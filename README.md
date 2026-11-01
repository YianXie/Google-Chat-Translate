# Google-Chat-Translate
Instantly translate messages in Google Chat and Google Space

A Chrome extension that adds a floating translate button next to each message in Google Chat. It translates on your own computer using Chrome's built-in on-device translator, so it's free, needs no API key, works offline, and your messages never leave your machine.

Works on chat.google.com (including the installed Chat app) and in Chat inside Gmail, in direct messages and Spaces.

## Install

You need desktop Chrome 138 or later and Node.js 24 or later.

```bash
npm install
```

```bash
npm run build
```

Then, in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist` folder.
3. Reload any Google Chat or Gmail tabs that were already open.

## Use

- **Translate a message:** hover over it and left-click the **文A** button that appears next to it. The translation shows up under the message. Click again to hide it.
- **Change languages:** right-click the **文A** button, or click the extension's icon in the toolbar. *Translate from* defaults to **Auto-detect**. Your choice applies to every message, and translations already on screen update to match.
- **Hide a translation:** use **Hide** or the **文A** control in the translation's header. Right-clicking that header also opens the language menu.

## Offline use

Chrome downloads a language pack the first time you translate a language, which needs an internet connection once. Each pack is about 60 MB and covers both directions; a shared library of about 20 MB is downloaded with the first pack, which can take a minute or two. After that, translation works with no network.

To get ready before going offline, click the toolbar icon and download languages under **Offline languages**. Pairs that don't include English, such as Spanish to Chinese, go through English and need both packs.

Chrome stores the packs and shares them across the browser. To remove one, use `chrome://on-device-translation-internals`.

## Languages

Arabic, Bangla, Bulgarian, Chinese (Simplified), Chinese (Traditional), Croatian, Czech, Danish, Dutch, English (US), Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Kannada, Korean, Lithuanian, Marathi, Norwegian, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Tamil, Telugu, Thai, Turkish, Ukrainian, Vietnamese.

## Privacy

The extension asks for one permission, `storage`, to remember your languages. It makes no network requests of its own and has no access to any site other than Google Chat. Message text goes only to Chrome's on-device translator. The only downloads are language packs, Chrome's translation library and its language detection model, all of which Chrome itself fetches from Google.

## Troubleshooting

| What you see | What to do |
|---|---|
| No button appears | Reload the Chat tab. Tabs opened before the extension was installed don't have it yet. |
| "On-device translation isn't available in this browser" | Update Chrome to 138 or later on desktop. On a managed work browser, an administrator may have turned it off with the `TranslatorAPIAllowed` policy. |
| "Couldn't download the … language pack" | That language isn't downloaded yet and Chrome couldn't fetch it. Check your connection and try again, or download it ahead of time from the toolbar icon. On a work network, a firewall may be blocking Chrome's component downloads. |
| "The extension was updated or reloaded" | Refresh the Chat tab. |
| A short message is detected as the wrong language | Very short messages are hard to detect. The translation's header shows what was detected; right-click **文A** to set *Translate from* yourself. |
| The button stops appearing after a Google Chat update | Google may have changed Chat's page. The selectors all live in `src/content/chat-dom.ts`. |

## Development

```bash
npm run watch
```

Rebuilds `dist/` on change; reload the extension in `chrome://extensions` afterwards.

```bash
npm run check
```

Runs the type check, the unit tests and a production build.

```bash
npm run e2e
```

Smoke-tests the extension in a separate window of your installed Chrome with a throwaway profile, using real translation against a local page shaped like Chat. The first run downloads language packs. Set `CHROME_PATH` if Chrome isn't in its default location.

See [docs/design.md](docs/design.md) for how it's built.
