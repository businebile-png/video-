# CLAUDE.md — Studio pub Systeme.io

Système de production de vidéos publicitaires verticales (TikTok, Instagram Reels) qui font découvrir
Systeme.io et ses abonnements payants via le lien affilié de l'utilisateur. L'utilisateur parle français :
répondre, commenter et écrire les messages de commit en français.

## Priorités

1. **Qualité** avant quantité : ne jamais déposer ni publier une vidéo médiocre pour tenir un horaire.
2. **Honnêteté** : aucun fait, prix, témoignage, statistique ou interface inventés ; « publiée » seulement
   quand la plateforme l'a confirmé ; dire clairement ce qui n'a pas pu être vérifié.
3. **Conversion** : l'objectif commercial est l'abonnement payant, sans promesse ni pression.

## Où sont les choses

- Déroulé d'une production : `docs/production-quotidienne.md` (à suivre étape par étape).
- Consigne du relecteur indépendant : `docs/relecteur.md`.
- Mise en route, architecture, conformité : `docs/`.
- Code : `src/` (CLI `npm run studio -- help`), rendu Remotion : `remotion/`, panneau : `panel/index.html`
  publié sur https://claude.ai/artifact/PHv2PwELy8staCztefioMr.
- Réglages : `config/studio.json` (technique) et le panneau (choix de l'utilisateur, importés par `panel:import`).
- Faits vérifiés : `data/facts/` ; une affirmation n'est utilisable que si son extrait figure mot pour mot
  dans une copie datée de la page officielle.
- Voix off : « Claire » (Chatterbox Multilingual + faster-whisper), locale et gratuite, « Siwis » (Kokoro)
  en secours ; installée par `bash scripts/setup-voice.sh` ; ne jamais imiter la voix d'une personne réelle.
- Production **sans Claude** (choix de l'utilisateur le 09/11/2026, quota hebdomadaire) : `npm run studio -- auto`
  dans GitHub Actions à 5:47 et 14:47, IA gratuite (FreeLLMAPI, Gemini…) pour le script et la relecture, mêmes
  verrous ; vidéo prête dans `queue/` : voir `docs/production-sans-claude.md`. Ne plus lancer de session de
  production Claude sans demande explicite.
- Publication : 100 % automatique, sans validation (choix de l'utilisateur le 08/11/2026) : deux vidéos par jour,
  à 10:00 et 20:00 sur TikTok et Instagram via Metricool. Pas de note minimum (choix de l'utilisateur le
  09/11/2026, `publish.decisionRule: "coherence"`) : la vidéo part si la relecture la juge cohérente et de bonne
  qualité et si tous les contrôles obligatoires sont validés (mention « Publicité », faits, droits, son) ; tâche courte à 9:35 et 19:35 dans une conversation Claude qui a le connecteur Metricool ; jamais deux
  vidéos au même créneau.
- Musique : « All For Nothing » (Zachariehs), choix de l'utilisateur qui déclare en avoir le droit (licence non
  vérifiée par le studio) : un extrait différent sous chaque vidéo (`music:overlay`, après la relecture) ; le
  fichier reste dans le stockage privé du panneau, jamais dans le dépôt public.

## Règles pour modifier le code

- Les verrous de publication (`src/qc/score.ts`) et le contrôleur de script (`src/script/lint.ts`) protègent
  l'utilisateur légalement : ne pas les assouplir sans demande explicite.
- La mention « Publicité » reste visible toute la vidéo et en tête de légende (loi n° 2023-451).
- Jamais d'images de richesse (voitures de luxe, argent, montres, jets) ni de « secret de ma réussite » :
  promesse de revenus implicite. Le format « edit » s'inspire du montage, pas de ce contenu.
- Aucun texte à l'écran hors de la zone sûre (`SAFE_AREA` dans `src/schemas/timeline.ts`).
- Pas de nouvelle source de média sans licence commerciale vérifiée et traçable.
- Tester : `npm test` (logique) et `npm run test:render -- <direction>` (rendu complet avec médias de
  synthèse, environ 10 minutes ; ne jamais publier ce rendu).
- Après modification de `remotion/` : vérifier visuellement quelques images d'un rendu de test.
