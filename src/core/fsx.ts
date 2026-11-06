import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type {z} from 'zod';

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, {recursive: true});
}

export function exists(file: string): boolean {
  return fs.existsSync(file);
}

export async function readJson<T = unknown>(file: string): Promise<T> {
  const raw = await fsp.readFile(file, 'utf8');
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as T;
  } catch (err) {
    throw new Error(`JSON invalide dans ${file} : ${(err as Error).message}`);
  }
}

export async function readJsonIfExists<T>(file: string, fallback: T): Promise<T> {
  if (!exists(file)) return fallback;
  return readJson<T>(file);
}

/** Read + validate with a zod schema, with a readable French error. */
export async function readValidated<S extends z.ZodType>(file: string, schema: S): Promise<z.infer<S>> {
  const data = await readJson(file);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 12)
      .map((i) => `  - ${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join('\n');
    throw new Error(`Fichier non conforme : ${path.relative(process.cwd(), file)}\n${issues}`);
  }
  return parsed.data;
}

/** Atomic JSON write (temp file + rename) so an interrupted run never leaves half a file. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

export async function writeText(file: string, text: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, file);
}

export async function appendJsonl(file: string, record: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fsp.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
}

export async function readJsonl<T = unknown>(file: string): Promise<T[]> {
  if (!exists(file)) return [];
  const raw = await fsp.readFile(file, 'utf8');
  const out: T[] = [];
  raw.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      throw new Error(`Ligne ${i + 1} illisible dans ${file}`);
    }
  });
  return out;
}

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}

export function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Hard-link when possible (no extra disk use), copy otherwise. */
export async function linkOrCopy(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  if (exists(dest)) await fsp.rm(dest, {force: true});
  try {
    await fsp.link(src, dest);
  } catch {
    await fsp.copyFile(src, dest);
  }
}

export async function fileSize(file: string): Promise<number> {
  return (await fsp.stat(file)).size;
}
