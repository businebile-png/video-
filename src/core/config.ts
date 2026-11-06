import {PATHS} from './paths.js';
import {readValidated, writeJson, readJson} from './fsx.js';
import {EditorialSchema, StudioConfigSchema, type Editorial, type StudioConfig} from '../schemas/config.js';

export async function loadConfig(): Promise<StudioConfig> {
  return readValidated(PATHS.config, StudioConfigSchema);
}

export async function saveConfig(config: StudioConfig): Promise<void> {
  StudioConfigSchema.parse(config);
  await writeJson(PATHS.config, config);
}

export async function loadEditorial(): Promise<Editorial> {
  return readValidated(PATHS.editorial, EditorialSchema);
}

/** Systeme.io affiliate links must keep the `sa` parameter and must not use "www" (official help article 162). */
export function affiliateLinkProblems(url: string): string[] {
  const problems: string[] = [];
  if (!url.trim()) return ['lien affilié non renseigné'];
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return ['ce n’est pas une adresse web valide'];
  }
  if (parsed.protocol !== 'https:') problems.push('le lien doit commencer par https://');
  if (parsed.hostname === 'www.systeme.io') problems.push('retirer « www » : Systeme.io indique que « www » casse le suivi d’affiliation');
  else if (parsed.hostname !== 'systeme.io') problems.push('le lien doit pointer vers systeme.io (sans www)');
  const sa = parsed.searchParams.get('sa');
  if (!sa) problems.push('paramètre « sa » absent : ce n’est pas un lien affilié');
  else if (!/^sa[0-9a-z]+$/i.test(sa)) problems.push('paramètre « sa » inattendu (il commence normalement par « sa » suivi de chiffres)');
  return problems;
}

export async function readRawConfig(): Promise<Record<string, unknown>> {
  return readJson(PATHS.config);
}
