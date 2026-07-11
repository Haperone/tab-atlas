import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(testsDirectory, '..');
export const extensionRoot = path.join(projectRoot, 'extension');

export async function readProjectText(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}

export async function readProjectJson(relativePath) {
  return JSON.parse(await readProjectText(relativePath));
}

export async function readPngDimensions(relativePath) {
  const bytes = await readFile(path.join(projectRoot, relativePath));
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`${relativePath} is not a valid PNG with an IHDR header`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}
