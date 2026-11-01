import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'build', 'server-pack');
const psSrc = path.join(root, 'server', 'ps');
const psDest = path.join(outDir, 'ps');
const serverRoot = path.join(root, 'server');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });

const importMetaUrlPlugin = {
  name: 'import-meta-url',
  setup(build) {
    build.onLoad({ filter: /\.js$/ }, async (args) => {
      const normalized = args.path.replace(/\\/g, '/');
      if (!normalized.includes('/server/')) return null;
      let contents = await fs.promises.readFile(args.path, 'utf8');
      if (!contents.includes('import.meta.url')) return null;
      contents = contents.replaceAll('import.meta.url', '__wt_import_meta_url');
      return { contents, loader: 'js' };
    });
  },
};

await esbuild.build({
  entryPoints: [path.join(serverRoot, 'index.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(outDir, 'server.cjs'),
  packages: 'bundle',
  banner: {
    js: 'var __wt_import_meta_url = require("url").pathToFileURL(__filename).href;',
  },
  plugins: [importMetaUrlPlugin],
  logLevel: 'info',
});

fs.cpSync(psSrc, psDest, { recursive: true });
fs.writeFileSync(path.join(outDir, 'data', '.gitkeep'), '');
console.log('bundled server →', outDir);
