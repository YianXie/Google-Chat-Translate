// Drives the built extension in the installed branded Chrome with a throwaway
// profile: Chromium builds have no on-device Translator, so this is the only way
// to exercise real translation. Language packs stay in .e2e-profile between runs.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import puppeteer, { type Browser, type Frame, type Page } from 'puppeteer-core';
import { CHROME_PATH } from '../scripts/chrome.ts';
import type { LanguageDetectorApi, TranslatorApi } from '../src/shared/built-in-ai.ts';

const EXTENSION_DIR = resolve('dist-e2e');
const PROFILE_DIR = resolve('.e2e-profile');
const OUTPUT_DIR = resolve('e2e/output');
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const OFFLINE_FLAG = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1';
// At least as strict as Google Chat: the injected UI must work without any page permission.
const PAGE_CSP = "default-src 'none'; style-src 'nonce-e2e'; img-src 'self'; connect-src https:; require-trusted-types-for 'script'";

interface BlockInfo {
  state: string | null;
  label: string | null | undefined;
  text: string | null | undefined;
}

function launch(extraArgs: string[] = []): Promise<Browser> {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    pipe: true,
    defaultViewport: null,
    // Puppeteer's defaults turn off background networking and Chrome's translate
    // features, which would stop the language packs from downloading.
    ignoreDefaultArgs: true,
    args: [
      `--user-data-dir=${PROFILE_DIR}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--password-store=basic',
      '--use-mock-keychain',
      // Keep timers running on time when this window is behind others.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1100,800',
      ...extraArgs,
      'about:blank',
    ],
  });
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  console.log(`… ${name}`);
  const result = await run();
  console.log(`✓ ${name}`);
  return result;
}

function frameOf(context: Page | Frame): Frame {
  return 'mainFrame' in context ? context.mainFrame() : context;
}

function blockInfo(context: Page | Frame, id: string): Promise<BlockInfo | null> {
  return frameOf(context).evaluate((messageId) => {
    const block = document.querySelector(`[data-id="${messageId}"] gct-translation`);
    if (!block) return null;
    return {
      state: block.getAttribute('data-state'),
      label: block.shadowRoot?.querySelector('.label')?.textContent,
      text: block.shadowRoot?.querySelector('.text')?.textContent,
    };
  }, id);
}

/** Polls a message's block until `done` accepts it, logging what it shows on the way. */
async function waitForBlock(context: Page | Frame, id: string, done: (info: BlockInfo) => boolean, timeoutMs = DOWNLOAD_TIMEOUT_MS): Promise<BlockInfo> {
  const deadline = Date.now() + timeoutMs;
  let lastLabel: string | null | undefined;
  let info: BlockInfo | null = null;
  while (Date.now() < deadline) {
    info = await blockInfo(context, id);
    if (info && info.label !== lastLabel) {
      lastLabel = info.label;
      console.log(`    ${id}: ${lastLabel}`);
    }
    if (info && done(info)) return info;
    await new Promise((settle) => setTimeout(settle, 500));
  }
  throw new Error(`Timed out waiting for the block on ${id}; last saw ${JSON.stringify(info)}`);
}

async function hoverButton(context: Page | Frame, id: string) {
  const frame = frameOf(context);
  await frame.hover(`[data-id="${id}"] [jsname="bgckF"]`);
  const button = await frame.waitForSelector('gct-overlay >>> button.translate', { visible: true, timeout: 5000 });
  assert.ok(button, `no floating button on ${id}`);
  return button;
}

async function translateMessage(context: Page | Frame, id: string, timeoutMs?: number): Promise<BlockInfo> {
  const button = await hoverButton(context, id);
  await button.click();
  return waitForBlock(context, id, (info) => info.state === 'done' || info.state === 'error', timeoutMs);
}

function watchForErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (error) => errors.push(`pageerror: ${(error as Error).message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
}

async function serviceWorkerOf(browser: Browser, extensionId: string) {
  return browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().startsWith(`chrome-extension://${extensionId}/`),
    { timeout: 30_000 },
  );
}

const fixture = await readFile('e2e/fixture.html');
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP });
    response.end(fixture);
  } else if (request.url === '/embed') {
    // Served from "localhost", so its 127.0.0.1 frame is cross-origin with no allow attribute, as in Gmail.
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><title>Embedding page</title><iframe src="${pageUrl}" style="width:100%;height:90vh;border:0"></iframe>`);
  } else {
    response.writeHead(204);
    response.end();
  }
});
await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
const port = (server.address() as AddressInfo).port;
const pageUrl = `http://127.0.0.1:${port}/`;
const embedUrl = `http://localhost:${port}/embed`;
await mkdir(OUTPUT_DIR, { recursive: true });

const errors: string[] = [];
let browser: Browser | undefined;
let page: Page | undefined;
try {
  console.log(`Chrome ${CHROME_PATH}`);
  browser = await launch();
  console.log(await browser.version());
  const onlineBrowser = browser;
  const extensionId = await step('load the extension', () => onlineBrowser.installExtension(EXTENSION_DIR));

  const workerTarget = await serviceWorkerOf(browser, extensionId);
  const workerRequests: string[] = [];
  const workerSession = await workerTarget.createCDPSession();
  await workerSession.send('Network.enable');
  workerSession.on('Network.requestWillBeSent', (event) => workerRequests.push(event.request.url));

  await step('the service worker has both built-in AI APIs', async () => {
    const worker = await workerTarget.worker();
    assert.ok(worker, 'the service worker target has no worker');
    const apis = await worker.evaluate(async () => {
      const scope = globalThis as unknown as { Translator?: TranslatorApi; LanguageDetector?: LanguageDetectorApi };
      return {
        translator: typeof scope.Translator,
        detector: typeof scope.LanguageDetector,
        spanish: await scope.Translator?.availability({ sourceLanguage: 'es', targetLanguage: 'en' }),
      };
    });
    console.log(`    ${JSON.stringify(apis)}`);
    assert.notEqual(apis.translator, 'undefined');
    assert.notEqual(apis.detector, 'undefined');
    assert.notEqual(apis.spanish, 'unavailable');
  });

  page = await browser.newPage();
  watchForErrors(page, errors);
  const chatPage = page;
  await step('the content script runs on the page', async () => {
    await chatPage.goto(pageUrl);
    await chatPage.waitForSelector('gct-overlay');
  });

  await step('the floating button appears beside the bubble, centred on it', async () => {
    await hoverButton(chatPage, 'msg-es');
    const placement = await chatPage.evaluate(() => {
      const bubble = (document.querySelector('[data-id="msg-es"] [jsname="bgckF"]')?.parentElement as Element).getBoundingClientRect();
      const button = document.querySelector('gct-overlay')?.shadowRoot?.querySelector('button')?.getBoundingClientRect() as DOMRect;
      return {
        gap: button.left - bubble.right,
        offCentre: Math.abs(button.top + button.height / 2 - (bubble.top + bubble.height / 2)),
      };
    });
    console.log(`    ${JSON.stringify(placement)}`);
    assert.ok(placement.gap >= 0 && placement.gap <= 12, 'button is not next to the bubble');
    assert.ok(placement.offCentre <= 2, 'button is not centred on the bubble');
  });

  const spanish = await step('left-click translates Spanish to English, detected automatically', async () => {
    const info = await translateMessage(chatPage, 'msg-es');
    console.log(`    ${info.label}: ${info.text}`);
    assert.equal(info.state, 'done');
    assert.equal(info.label, 'Spanish → English (US)');
    assert.match(info.text ?? '', /tomorrow/i);
    return info;
  });
  await chatPage.screenshot({ path: `${OUTPUT_DIR}/translated.png` });

  await step('the translation sits right after the message body', async () => {
    const after = await chatPage.evaluate(
      () => document.querySelector('[data-id="msg-es"] [jsname="bgckF"]')?.nextElementSibling?.localName,
    );
    assert.equal(after, 'gct-translation');
  });

  await step('Chinese is detected and translated too', async () => {
    const info = await translateMessage(chatPage, 'msg-zh');
    console.log(`    ${info.label}: ${info.text}`);
    assert.equal(info.state, 'done');
    assert.equal(info.label, 'Chinese (Simplified) → English (US)');
    assert.match(info.text ?? '', /office|tomorrow/i);
  });

  await step('a message already in the target language says so', async () => {
    const info = await translateMessage(chatPage, 'msg-en');
    assert.equal(info.label, 'Already in English (US)');
  });

  await step('line breaks survive translation', async () => {
    const info = await translateMessage(chatPage, 'msg-lines');
    console.log(`    ${JSON.stringify(info.text)}`);
    assert.equal(info.state, 'done');
    assert.equal(info.text?.split('\n').length, 3);
  });

  await step('emoji-only messages get no button', async () => {
    await chatPage.hover('[data-id="msg-emoji"] [jsname="bgckF"]');
    await chatPage.waitForFunction(() => document.querySelector('gct-overlay')?.shadowRoot?.querySelector('button')?.hidden, {
      polling: 100,
      timeout: 10_000,
    });
  });

  await step('right-click opens the language menu and changing To re-translates through English', async () => {
    const button = await hoverButton(chatPage, 'msg-es');
    await button.click({ button: 'right' });
    await chatPage.waitForSelector('gct-menu >>> select[name="target"]', { visible: true, timeout: 5000 });
    await chatPage.screenshot({ path: `${OUTPUT_DIR}/menu.png` });
    const menuOverflow = await chatPage.evaluate(() => {
      const panel = document.querySelector('gct-menu')?.shadowRoot?.querySelector('.menu') as Element;
      return panel.scrollWidth - panel.clientWidth;
    });
    assert.equal(menuOverflow, 0, 'the language menu overflows its width');
    await chatPage.select('gct-menu >>> select[name="target"]', 'zh');
    const info = await waitForBlock(chatPage, 'msg-es', (block) => block.label === 'Spanish → Chinese (Simplified)' && block.state === 'done');
    console.log(`    ${info.label}: ${info.text}`);
    await chatPage.keyboard.press('Escape');
    assert.equal(await chatPage.$('gct-menu'), null);
  });

  await step('the toolbar menu shows the same languages and changes them for open translations', async () => {
    const popup = await onlineBrowser.newPage();
    watchForErrors(popup, errors);
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector('.status[data-loaded="true"]');
    assert.equal(await popup.$eval('select[name="target"]', (select) => (select as HTMLSelectElement).value), 'zh');
    await popup.select('select[name="target"]', 'en');
    await popup.waitForFunction(() => document.querySelector('.heading')?.textContent === 'Offline languages into English (US)');
    await popup.waitForFunction(() => /Spanish/.test(document.querySelector('.ready')?.textContent ?? ''));
    console.log(`    ${await popup.$eval('.ready', (ready) => ready.textContent)}`);
    await popup.setViewport({ width: 320, height: 520 });
    const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await popup.screenshot({ path: `${OUTPUT_DIR}/popup.png` });
    assert.equal(overflow, 0, 'the toolbar menu overflows its width');
    await popup.close();
    await chatPage.bringToFront();
    await waitForBlock(chatPage, 'msg-es', (block) => block.label === 'Spanish → English (US)' && block.state === 'done');
  });

  await step('Hide removes the translation, and the button brings it back', async () => {
    const hide = await chatPage.waitForSelector('[data-id="msg-es"] gct-translation >>> .hide', { visible: true });
    await hide?.click();
    assert.equal(await blockInfo(chatPage, 'msg-es'), null);
    const info = await translateMessage(chatPage, 'msg-es', 10_000);
    assert.equal(info.text, spanish.text);
  });

  await step('it translates inside a cross-origin frame with no translator permission, as in Gmail', async () => {
    const embedding = await onlineBrowser.newPage();
    watchForErrors(embedding, errors);
    await embedding.goto(embedUrl);
    const frame = await (await embedding.waitForSelector('iframe'))?.contentFrame();
    assert.ok(frame, 'the embedded frame did not load');
    await frame.waitForSelector('gct-overlay');
    const pageApi = await frame.evaluate(() =>
      (globalThis as unknown as { Translator: TranslatorApi }).Translator.availability({ sourceLanguage: 'es', targetLanguage: 'en' }),
    );
    console.log(`    the page's own Translator in this frame says: ${pageApi}`);
    assert.equal(pageApi, 'unavailable');
    const info = await translateMessage(frame, 'msg-es', 60_000);
    console.log(`    ${info.label}: ${info.text}`);
    assert.equal(info.label, 'Spanish → English (US)');
    await embedding.close();
    await chatPage.bringToFront();
  });

  await step('the floating button and menu follow a dark page', async () => {
    await chatPage.evaluate(() => {
      document.body.style.background = '#1f1f1f';
      document.body.style.color = '#e3e3e3';
      for (const bubble of document.querySelectorAll<HTMLElement>('[jsname="o7uNDd"]')) bubble.style.background = '#3c4043';
    });
    await hoverButton(chatPage, 'msg-en');
    const button = await hoverButton(chatPage, 'msg-late');
    await button.click({ button: 'right' });
    await chatPage.waitForSelector('gct-menu >>> select[name="target"]', { visible: true, timeout: 5000 });
    const themes = await chatPage.evaluate(() => [
      document.querySelector('gct-overlay')?.getAttribute('data-theme'),
      document.querySelector('gct-menu')?.getAttribute('data-theme'),
    ]);
    await chatPage.screenshot({ path: `${OUTPUT_DIR}/dark.png` });
    await chatPage.keyboard.press('Escape');
    assert.deepEqual(themes, ['dark', 'dark']);
  });

  await step('the extension itself made no network requests', async () => {
    assert.deepEqual(workerRequests, []);
  });

  await step('translation still works after Chrome stops the idle service worker', async () => {
    // DevTools attached to a worker keeps it alive, so stop it explicitly to cover a real restart.
    const extensionPage = await onlineBrowser.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);
    const session = await extensionPage.createCDPSession();
    let status = '';
    session.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      const version = versions.find((candidate) => candidate.scriptURL.startsWith(`chrome-extension://${extensionId}/`));
      if (version) status = version.runningStatus;
    });
    const statusBecomes = async (wanted: string) => {
      const deadline = Date.now() + 10_000;
      while (status !== wanted && Date.now() < deadline) await new Promise((settle) => setTimeout(settle, 100));
      assert.equal(status, wanted, `the service worker should be ${wanted}`);
    };
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
    await statusBecomes('stopped');

    await chatPage.bringToFront();
    const info = await translateMessage(chatPage, 'msg-late', 60_000);
    console.log(`    ${info.label}: ${info.text}`);
    assert.equal(info.state, 'done');
    assert.equal(info.label, 'Spanish → English (US)');
    await statusBecomes('running');
    await extensionPage.close();
  });

  await browser.close();
  browser = undefined;

  browser = await step('relaunch with all DNS blocked', () => launch([OFFLINE_FLAG]));
  const offlineBrowser = browser;
  await step('load the extension again', () => offlineBrowser.installExtension(EXTENSION_DIR));
  page = await browser.newPage();
  watchForErrors(page, errors);
  const offlinePage = page;
  await offlinePage.goto(pageUrl);
  await offlinePage.waitForSelector('gct-overlay');

  await step('translation still works offline', async () => {
    const reachable = await offlinePage.evaluate(() =>
      fetch('https://www.example.com/', { mode: 'no-cors' }).then(
        () => true,
        () => false,
      ),
    );
    assert.equal(reachable, false, 'the network should be unreachable in this phase');
    const info = await translateMessage(offlinePage, 'msg-es', 60_000);
    console.log(`    ${info.label}: ${info.text}`);
    assert.equal(info.state, 'done');
    assert.equal(info.text, spanish.text);
  });

  await step('no page or extension errors', async () => {
    // The offline probe above fails on purpose.
    const unexpected = errors.filter((error) => !error.includes('ERR_NAME_NOT_RESOLVED'));
    assert.deepEqual(unexpected, []);
  });

  console.log('\nE2E PASSED');
} catch (error) {
  process.exitCode = 1;
  console.error('\nE2E FAILED\n', error);
  if (errors.length > 0) console.error('Errors seen:', errors);
  await page?.screenshot({ path: `${OUTPUT_DIR}/failure.png` }).catch(() => {});
} finally {
  await browser?.close();
  server.close();
}
