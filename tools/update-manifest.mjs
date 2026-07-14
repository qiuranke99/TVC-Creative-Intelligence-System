#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolDirectory, '..');
const manifestPath = path.join(root, 'MANIFEST.sha256');
const excludedFiles = new Set(['MANIFEST.sha256', '.DS_Store', 'Thumbs.db', 'Desktop.ini']);
const excludedDirectories = new Set(['.git', 'node_modules', '.tcis-tmp', 'coverage', 'tmp']);
const excludedDirectoryPaths = new Set(['tasks/current']);

const files = await walk(root);
const lines = [];
for (const absolutePath of files) {
  const relativePath = normalize(path.relative(root, absolutePath));
  const bytes = await readFile(absolutePath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  lines.push(`${hash}  ${bytes.length}  ${relativePath}`);
}

await writeFile(manifestPath, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ manifest: manifestPath, entries: lines.length, verdict: 'UPDATED' })}\n`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = normalize(path.relative(root, absolutePath));
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (excludedDirectories.has(entry.name) || excludedDirectoryPaths.has(relativePath)) continue;
      output.push(...await walk(absolutePath));
      continue;
    }
    if (
      entry.isFile()
      && !excludedFiles.has(entry.name)
      && !entry.name.toLowerCase().endsWith('.log')
      && (await stat(absolutePath)).isFile()
    ) output.push(absolutePath);
  }
  return output.sort((left, right) => normalize(path.relative(root, left)).localeCompare(normalize(path.relative(root, right)), 'en'));
}

function normalize(value) {
  return value.split(path.sep).join('/');
}
