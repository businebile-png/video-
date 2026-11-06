import type {Script} from '../src/schemas/script.js';
import type {Fact} from '../src/schemas/facts.js';

export function sampleScript(overrides: Partial<Script> = {}): Script {
  return {
    runId: '2026-11-06-a',
    category: 'pub-directe',
    angle: 'Les ventes qui se perdent entre plusieurs outils qui ne se parlent pas',
    persona: 'Créatrice de contenu qui vend un premier guide',
    hookStyle: 'question-directe',
    workingTitle: 'Cinq outils pour une seule vente',
    targetDurationSec: 32,
    scenes: [
      {id: 's1', phase: 'hook', voiceover: 'Tu paies cinq outils différents pour vendre un seul produit ?', emphasis: ['cinq outils'], visual: {kind: 'broll', queries: ['woman laptop stress', 'many browser tabs'], shotIdeas: [], focusRegionIds: []}, claimFactIds: []},
      {id: 's2', phase: 'problem', voiceover: 'Une page ici, des messages là-bas, l’argent ailleurs. Et chaque connexion peut casser.', emphasis: [], visual: {kind: 'broll', queries: ['desk laptop night', 'tired freelancer'], shotIdeas: [], focusRegionIds: []}, claimFactIds: []},
      {id: 's3', phase: 'solution', voiceover: 'Avec Systeme.io, l’essentiel est réuni au même endroit, dans un seul compte.', emphasis: ['même endroit'], visual: {kind: 'broll', queries: ['entrepreneur smiling laptop', 'home office morning'], shotIdeas: [], focusRegionIds: []}, claimFactIds: []},
      {id: 's4', phase: 'benefits', voiceover: 'Tu gardes une vue claire sur ce qui se passe, sans jongler entre les onglets.', emphasis: ['sans jongler'], visual: {kind: 'broll', queries: ['coffee notebook planning', 'woman typing calm'], shotIdeas: [], focusRegionIds: []}, claimFactIds: []},
      {id: 's5', phase: 'cta', voiceover: 'Le lien est dans ma bio : regarde comment c’est organisé avant de choisir.', emphasis: ['dans ma bio'], visual: {kind: 'broll', queries: ['phone scrolling hand'], shotIdeas: [], focusRegionIds: []}, claimFactIds: []},
    ],
    cta: {onScreen: 'Découvre Systeme.io', subline: 'Regarde l’organisation avant de choisir', reason: 'Voir concrètement si centraliser convient à son activité'},
    captions: {tiktok: 'Une vente, cinq outils ? Il existe plus simple. Lien en bio.', instagram: 'Une vente, cinq outils ? Il existe plus simple. Lien en bio.', hashtags: ['#entrepreneur', '#businessenligne', '#systemeio']},
    author: 'agent',
    ...overrides,
  };
}

export function fact(id: string, statement: string, tags: string[], evidence = statement): Fact {
  return {id, statement, tags, sourceId: 'pricing', evidence, status: 'verified', verifiedAt: '2026-11-06T06:00:00.000Z', ttlDays: 7};
}
