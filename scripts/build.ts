import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import { buildManifest, type ExtensionManifest } from './manifest.ts';

const args = new Set(process.argv.slice(2));
const e2e = args.has('--e2e');
const watch = args.has('--watch');
const outdir = e2e ? 'dist-e2e' : 'dist';

const STATIC_FILES: [from: string, to: string][] = [
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
  ['icons', 'icons'],
];

const options: esbuild.BuildOptions = {
  entryPoints: {
    content: 'src/content/main.ts',
    'service-worker': 'src/background/service-worker.ts',
    popup: 'src/popup/popup.ts',
  },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome138',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

async function copyStatic(): Promise<void> {
  const manifest = JSON.parse(await readFile('manifest.json', 'utf8')) as ExtensionManifest;
  await writeFile(`${outdir}/manifest.json`, `${JSON.stringify(buildManifest(manifest, { e2e }), null, 2)}\n`);
  for (const [from, to] of STATIC_FILES) await cp(from, `${outdir}/${to}`, { recursive: true });
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  await copyStatic();
} else {
  await esbuild.build(options);
  await copyStatic();
}
