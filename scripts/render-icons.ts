import { mkdir, readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { CHROME_PATH } from './chrome.ts';

const SIZES = [16, 32, 48, 128];

const svg = await readFile('assets/icon.svg', 'utf8');
await mkdir('icons', { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: `icons/icon-${size}.png`, omitBackground: true });
  }
} finally {
  await browser.close();
}
