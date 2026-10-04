import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const config = await readFile(resolve(root, 'config/browser-runtime.toml'), 'utf8');
const value = (key) => {
  const found = config.match(new RegExp('^' + key + ' = "([^"]+)"', 'm'));
  if (!found) throw Error('Missing runtime manifest entry: ' + key);
  return found[1];
};
const version = value('node_version');
if (!/^24\.\d+\.\d+$/.test(version)) throw Error('Unexpected Node runtime version');
const output = resolve(root, 'src-tauri/resources/browser-runtime');
const cache = resolve(root, 'work/browser-runtime');
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
const archive = resolve(cache, 'node-v' + version + '-win-x64.zip');
const digest = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
if ((await digest(archive).catch(() => '')) !== value('node_zip_sha256')) {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  execFileSync(
    'curl.exe',
    [
      '--fail',
      '--location',
      '--max-time',
      '180',
      ...(proxy ? ['--proxy', proxy] : []),
      'https://nodejs.org/dist/v' + version + '/node-v' + version + '-win-x64.zip',
      '--output',
      archive,
    ],
    { windowsHide: true, stdio: 'inherit' },
  );
  if ((await digest(archive)) !== value('node_zip_sha256'))
    throw Error('Node archive checksum mismatch');
}
const unpacked = resolve(cache, 'node-v' + version + '-win-x64');
if ((await digest(resolve(unpacked, 'node.exe')).catch(() => '')) !== value('node_exe_sha256')) {
  execFileSync('tar.exe', ['-xf', archive, '-C', cache], { windowsHide: true, stdio: 'inherit' });
}
if ((await digest(resolve(unpacked, 'node.exe'))) !== value('node_exe_sha256'))
  throw Error('Node executable checksum mismatch');
await cp(resolve(unpacked, 'node.exe'), resolve(output, 'node.exe'));
await cp(resolve(unpacked, 'LICENSE'), resolve(output, 'NODE-LICENSE.txt'));
const packagePath = require.resolve('playwright-core/package.json');
const packageInfo = JSON.parse(await readFile(packagePath, 'utf8'));
if (packageInfo.version !== value('playwright_version'))
  throw Error('Playwright runtime version mismatch');
await cp(dirname(packagePath), resolve(output, 'node_modules/playwright-core'), {
  recursive: true,
  dereference: true,
});
await cp(resolve(root, 'runtime/browser'), output, { recursive: true });
await writeFile(
  resolve(output, 'runtime.json'),
  JSON.stringify(
    {
      node: version,
      playwright: packageInfo.version,
      nodeSha256: await digest(resolve(output, 'node.exe')),
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(
  'Prepared bundled browser runtime: Node ' + version + ', Playwright ' + packageInfo.version,
);
