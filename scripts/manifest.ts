export interface ContentScript {
  matches: string[];
  js: string[];
  all_frames?: boolean;
  run_at?: string;
}

export interface ExtensionManifest {
  content_scripts: ContentScript[];
  [key: string]: unknown;
}

const E2E_ORIGIN = 'http://127.0.0.1/*';

/** The manifest to ship. E2e builds also run on the local fixture server. */
export function buildManifest(manifest: ExtensionManifest, options: { e2e: boolean }): ExtensionManifest {
  const copy = structuredClone(manifest);
  if (options.e2e) {
    for (const script of copy.content_scripts) script.matches.push(E2E_ORIGIN);
  }
  return copy;
}
