import fs from 'node:fs';
import path from 'node:path';
import {runPaths} from '../core/paths.js';
import {readJson, writeJson} from '../core/fsx.js';
import {autoSelection} from '../footage/footage-step.js';
import {chat, compact, extractJson, imagePart} from '../llm/client.js';
import {log} from '../core/log.js';
import type {Script} from '../schemas/script.js';

type Candidate = {pexelsId: number; author: string};
type CandidatesFile = Parameters<typeof autoSelection>[0];

/**
 * The shots chosen by eye, as a Claude session did: for each scene, the AI looks at the numbered contact sheet
 * and picks the clips that show what the sentence says. Any scene it cannot answer keeps the automatic choice.
 */
export async function chooseFootageWithLlm(runId: string): Promise<void> {
  const p = runPaths(runId);
  const file = await readJson<CandidatesFile>(p.footageCandidates);
  const fallback = autoSelection(file);
  const script = await readJson<Script>(p.script);
  const scenes: Record<string, number[]> = {...fallback.scenes};
  const used = new Set<number>();
  let chosen = 0;
  for (const [sceneId, cands] of Object.entries(file.scenes) as Array<[string, Candidate[]]>) {
    const need = file.needs[sceneId] ?? 1;
    const sheet = path.join(p.footageDir, 'sheets', `${sceneId}.jpg`);
    const scene = script.scenes.find((s) => s.id === sceneId);
    if (need <= 0 || !scene || !fs.existsSync(sheet) || cands.length <= need) {
      for (const id of scenes[sceneId] ?? []) used.add(id);
      continue;
    }
    try {
      const reply = await chat(
        [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  'Tu choisis les plans d’une publicité verticale française pour Systeme.io. Planche contact ci-dessous : chaque vignette porte un numéro, puis « #identifiant ».',
                  `Phrase dite pendant ces plans : « ${scene.voiceover} »`,
                  scene.visual.shotIdeas.length ? `Ce que les plans doivent montrer : ${scene.visual.shotIdeas.join(' ; ')}` : '',
                  `Choisis ${need} plan(s), du meilleur au moins bon : en rapport direct avec la phrase, nets, lumineux, naturels, personnes crédibles, sans texte incrusté, sans logo, sans signe de richesse (voiture de luxe, billets, montre), rien qui laisse croire qu’une personne filmée recommande le produit. Le premier plan de la vidéo doit arrêter le pouce : sujet clair et contrasté.`,
                  `Réponds uniquement en JSON : {"ids": [identifiants lus après #], "raison": "une phrase"}`,
                ]
                  .filter(Boolean)
                  .join('\n'),
              },
              imagePart(sheet, compact() ? 'high' : undefined),
            ],
          },
        ],
        {vision: true, temperature: 0.2, maxTokens: 400},
      );
      const ids = (extractJson<{ids?: unknown[]}>(reply.text).ids ?? []).map((x) => Number(String(x).replace(/\D/g, ''))).filter((id) => cands.some((c) => c.pexelsId === id) && !used.has(id));
      if (ids.length) {
        const pick = [...new Set(ids)].slice(0, need);
        // Complete with the automatic ranking when the AI named fewer clips than needed.
        for (const c of cands) if (pick.length < need && !pick.includes(c.pexelsId) && !used.has(c.pexelsId)) pick.push(c.pexelsId);
        scenes[sceneId] = pick;
        chosen++;
      }
    } catch (e) {
      log.warn(`Plans de ${sceneId} : choix automatique gardé (${(e as Error).message.slice(0, 160)})`);
    }
    for (const id of scenes[sceneId] ?? []) used.add(id);
  }
  await writeJson(p.footageSelection, {by: 'agent', notes: `Plans choisis à l’œil par l’IA sur les planches (${chosen} scène(s)), classement automatique ailleurs.`, scenes});
  log.ok(`Plans choisis par l’IA pour ${chosen} scène(s) sur ${Object.keys(file.scenes).length}`);
}
