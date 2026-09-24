import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const npm = await readJson(resolve(root, 'work/npm-licenses.json'));
const rust = await readJson(resolve(root, 'work/rust-metadata.json'));
const notices = ['FluxCode third-party notices\n\nThis inventory includes transitive and build dependencies conservatively.\nThe corresponding copyright and license terms remain with their owners.\n'];
const inventory = [];
const missing = [];

async function collect(name, version, license, directory, extra) {
  const files = (await readdir(directory)).filter(name => /^(licen[cs]e|copying|notice|unlicense|copyright)/i.test(name));
  if (extra && !files.includes(extra)) files.push(extra);
  const texts = [];
  for (const file of files) {
    try { texts.push(`${file}\n${await readFile(join(directory, file), 'utf8')}`); } catch { /* Directory names are not license files. */ }
  }
  inventory.push({ name, version, license });
  if (!texts.length) missing.push({ name, version, license, directory });
  notices.push(`\n${'='.repeat(72)}\n${name} ${version}\nLicense: ${license}\n\n${texts.join('\n\n') || 'See SPDX license expression above; no standalone license file in this package.'}\n`);
}

for (const packages of Object.values(npm)) {
  for (const pkg of packages) for (let i = 0; i < pkg.paths.length; i++) await collect(pkg.name, pkg.versions[i] ?? pkg.versions[0], pkg.license, pkg.paths[i]);
}
for (const pkg of rust.packages.filter(p => p.source)) await collect(pkg.name, pkg.version, pkg.license ?? 'LicenseRef-Custom', dirname(pkg.manifest_path), pkg.license_file);
await writeFile(resolve(root, 'src-tauri/resources/legal/THIRD-PARTY-NOTICES.txt'), notices.join('\n'), 'utf8');
await writeFile(resolve(root, 'docs/dependency-inventory.json'), JSON.stringify(inventory, null, 2) + '\n', 'utf8');
await writeFile(resolve(root, 'work/missing-license-files.json'), JSON.stringify(missing, null, 2), 'utf8');
console.log(JSON.stringify({ dependencies: inventory.length, licenseExpressions: [...new Set(inventory.map(p => p.license))], packagesWithoutStandaloneLicenseFile: missing.map(p => `${p.name}@${p.version}`) }, null, 2));
