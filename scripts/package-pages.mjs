import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function packagePages(buildDirectory = 'dist') {
  const root = path.resolve(buildDirectory);
  const output = path.join(root, 'pages');
  if (path.dirname(output) !== root) throw new Error('Invalid output directory');
  await stat(path.join(root, 'server/index.js'));
  const client = path.join(root, 'client');
  const entries = await readdir(client, { withFileTypes: true });
  const reserved = new Set(['api', '_worker.js', '_routes.json']);
  if (entries.some(entry => reserved.has(entry.name))) throw new Error('Reserved path in public assets');
  const allowed = async source => {
    const name = path.basename(source);
    if (name.startsWith('.') || name.endsWith('.pem') || name.endsWith('.map')) return false;
    return true;
  };
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(client, output, { recursive: true, filter: allowed });
  await cp(path.join(root, 'server'), path.join(output, '_worker.js/application'), {
    recursive: true,
    filter: async source => (await stat(source)).isDirectory() || /\.(?:m?js|wasm)$/.test(source),
  });
  await writeFile(path.join(output, '_worker.js/index.js'), 'export { default } from "./application/index.js";\n');
  const exclude = entries.filter(entry => !entry.name.startsWith('.') && (!entry.name.startsWith('_') || entry.name === '_next')).map(entry =>
    entry.name === '_next' ? '/_next/static/*' : `/${entry.name}${entry.isDirectory() ? '/*' : ''}`,
  );
  if (exclude.length > 99) throw new Error('Too many asset routes for Pages');
  await writeFile(path.join(output, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude }, null, 2));
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(`Pages output: ${await packagePages()}`);
}
