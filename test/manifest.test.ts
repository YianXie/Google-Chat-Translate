import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildManifest, type ExtensionManifest } from '../scripts/manifest.ts';

const base = JSON.parse(readFileSync('manifest.json', 'utf8')) as ExtensionManifest;

describe('manifest.json', () => {
  it('asks only for the storage permission and no host permissions', () => {
    expect(base.permissions).toEqual(['storage']);
    expect(base).not.toHaveProperty('host_permissions');
  });

  it('injects the content script into every Chat frame', () => {
    expect(base.content_scripts).toEqual([
      {
        matches: ['https://chat.google.com/*', 'https://mail.google.com/chat/*'],
        js: ['content.js'],
        all_frames: true,
        run_at: 'document_idle',
      },
    ]);
  });
});

describe('buildManifest', () => {
  it('keeps the production manifest as written', () => {
    expect(buildManifest(base, { e2e: false })).toEqual(base);
  });

  it('lets e2e builds run on the local fixture server', () => {
    const manifest = buildManifest(base, { e2e: true });
    expect(manifest.content_scripts[0]?.matches).toEqual([
      'https://chat.google.com/*',
      'https://mail.google.com/chat/*',
      'http://127.0.0.1/*',
    ]);
  });

  it('leaves the source manifest untouched', () => {
    const before = structuredClone(base);
    buildManifest(base, { e2e: true });
    expect(base).toEqual(before);
  });
});
