import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const png = path.join(root, 'build', 'icon.png');
const ico = path.join(root, 'build', 'icon.ico');
const electronPng = path.join(root, 'electron', 'icon.png');

if (!fs.existsSync(png)) throw new Error(`Missing ${png}`);
const buf = await pngToIco(png);
fs.writeFileSync(ico, buf);
fs.copyFileSync(png, electronPng);
console.log('wrote', ico, `(${buf.length} bytes)`);
