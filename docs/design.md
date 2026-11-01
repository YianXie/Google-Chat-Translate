# Design

## Why translation runs in the service worker

Translation uses Chrome's built-in `Translator` and `LanguageDetector` APIs (Chrome 138+): free, on-device, and offline once a language pack is downloaded. The engine runs in the extension's service worker rather than in the page, for three reasons:

- **Gmail's frames can't use the APIs.** Chat inside Gmail runs in cross-origin `chat.google.com/u/N/frame?…` iframes. Their `allow` list has no `translator`, so the APIs are blocked there.
- **Page contexts need a click for each new pair.** There, `create()` consumes a user gesture whenever a pair reports `downloadable`, and only one `create()` is allowed per click.
- **Availability is hidden per origin.** A pack already on disk still reports `downloadable` to an origin that hasn't used that pair, so chat.google.com and mail.google.com would each go through this separately.

Extension service workers have both APIs and don't need a user gesture (Chromium changes 6476148, 6509173 and 6507441). The public docs still say "not in workers", so this is worth re-checking if it ever stops working. The fallback would be to host the engine in the top-frame content script and relay requests from Gmail's iframes.

## Structure

```
Chat frame (chat.google.com top document, or Gmail's chat.google.com iframes)
  content script (isolated world, all_frames)
    chat-dom ── controller ── translation-block   (inserted right after the message body)
                   │     └─ hover-button + language-menu   (one fixed overlay per frame)
                   └─ engine-client ──port──► service worker: engine (LanguageDetector + Translator)
popup: language-picker + offline packs ─ engine-client ──port──► (same service worker)
chrome.storage.sync ◄── settings ──► content scripts + popup (onChanged)
```

| Module | Responsibility |
|---|---|
| `src/shared/languages.ts` | Supported codes, labels, tag normalisation |
| `src/shared/settings.ts` | The global `{source, target}` setting in `chrome.storage.sync` |
| `src/shared/protocol.ts`, `engine-client.ts` | Port messages; one port per request, with a keepalive ping |
| `src/shared/language-picker.ts` | From/To selects, shared by the menu and the popup |
| `src/shared/error-text.ts`, `dom.ts` | Error wording; DOM helpers (no `innerHTML`) |
| `src/background/detect.ts` | Language detection, with `chrome.i18n.detectLanguage` as a fallback |
| `src/background/engine.ts` | Translators per pair, line-by-line translation, result cache, downloads |
| `src/background/port-server.ts`, `service-worker.ts` | Answers port requests |
| `src/content/chat-dom.ts` | **All knowledge of Chat's markup** |
| `src/content/controller.ts` | Per-message state, keyed by Chat's message id |
| `src/content/translation-block.ts`, `hover-button.ts`, `language-menu.ts` | In-page UI, each in a shadow root |
| `src/content/app.ts` | Wiring: MutationObserver, navigation events, settings watch |
| `src/popup/app.ts` | Toolbar menu: languages and offline downloads |

## Behaviour worth knowing

- **Surviving Chat's re-renders.** Chat replaces message nodes when a message is confirmed or edited, and loads history lazily. State is keyed by `data-id`, and a debounced `reconcile()` puts blocks back, translates edited text again, and removes strays. The thread side panel repeats a thread's first message with the same id, so each copy gets its own block from the same state.
- **Staying out of Chat's way.** Events stop at our hosts so Chat's click and key handlers don't fire. UI is built with `textContent` only; Chat enforces Trusted Types, and translations are untrusted text. Nothing is injected into Chat's own hover toolbar, because it re-renders and drops foreign children.
- **What gets translated.** Quoted replies, code blocks and Chat's controls are left out. Lines that are only a URL or have no letters pass through unchanged, and emoji-only messages get no button.
- **Detection.** The highest-confidence supported language wins. Detectors report both Chinese scripts as `zh`, so a character check separates Traditional from Simplified. While the detector model downloads, `chrome.i18n.detectLanguage` answers instead. It's weak on short text, so the block's header always names the detected language and the menu can pin the source.
- **Translators don't survive a pack install.** Installing a language pack restarts Chrome's translation service, and every existing translator then fails with `UnknownError: Other generic failures occurred.` The engine drops a failed translator and retries once on a new one.
- **Packs can arrive before the library.** Chrome's shared library and each language pack download separately. While the library is missing, Chrome stores a relative path for it, so its readiness check passes wrongly. If a pack finishes first, `create()` throws `NotSupportedError` (the console says "service count exceeded") until the library arrives, which took over a minute in testing. The engine retries for up to 5 minutes and shows that Chrome's translation engine is downloading.
- **Stalled downloads.** A download with no progress is reported as failed after 15 seconds offline and after 5 minutes online. Online gets longer because Chrome's progress events can be coarse.

## Testing

Unit and integration tests run in Vitest with jsdom, against fakes for Chrome's AI APIs and extension APIs. `test/fixtures/chat.html` is sanitized from a live Chat page: its structure and attributes are real, and its text is replaced.

jsdom has no layout, and Playwright's Chromium has no Translator, so `e2e/smoke.ts` drives the installed branded Chrome through puppeteer-core with a throwaway profile, loading the extension over CDP. Its fixture page sends a strict Content-Security-Policy with Trusted Types. It also translates inside a cross-origin frame with no `allow` attribute, as in Gmail, and restarts the service worker, because DevTools attached to a worker stops it going idle. It can't reach real Google Chat, so the last check is a manual one on a real account.

## Known gaps

Not yet checked on a real page:

- **Chat inside Gmail.** Chat is off on the account used for the live check. A cross-origin test frame with no `allow` attribute passes in the smoke test.
- **Messages from other people and @mentions.** The live check only had one person's right-aligned bubbles, so the button or Chat's toolbar may sit differently on incoming messages.
- **Dark Chat.** Dark rendering has only been checked on the test page.
- **Clicking the toolbar icon.** The popup page itself is tested, but not by clicking the icon.

Small things left:

- There's no keyboard way to translate. Messages are focusable (`tabindex`), but the button sits at the end of `<html>`, so Tab can't reach it. A shortcut on the focused message would work.
- After an extension reload, language changes in the in-page menu fail silently until the tab is refreshed. The next translate click does explain it.
- A lost port always reads "updated or reloaded", and one rare popup failure says "Click the translate button".
- The auto-detect model downloads on first translation, while the popup presents it as an opt-in button.
- Messages that are only a URL get a button and then say "Already in English (US)" or similar.
- Building language labels costs about 14 ms in every Chat frame at load.
- The button can go stale after a layout shift with no scroll, and hides if Chat replaces the hovered message.
- Routed pairs such as es→zh say "the Spanish language pack" although two may download.
- `getBubble`, `looksTraditional` and both `isOpen` methods are used only by tests.
- `package.json` has no `engines` field, although the build needs Node 24+.
