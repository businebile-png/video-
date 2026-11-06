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

## Règles pour modifier le code

- Les verrous de publication (`src/qc/score.ts`) et le contrôleur de script (`src/script/lint.ts`) protègent
  l'utilisateur légalement : ne pas les assouplir sans demande explicite.
- La mention « Publicité » reste visible toute la vidéo et en tête de légende (loi n° 2023-451).
- Aucun texte à l'écran hors de la zone sûre (`SAFE_AREA` dans `src/schemas/timeline.ts`).
- Pas de nouvelle source de média sans licence commerciale vérifiée et traçable.
- Tester : `npm test` (logique) et `npm run test:render -- <direction>` (rendu complet avec médias de
  synthèse, environ 10 minutes ; ne jamais publier ce rendu).
- Après modification de `remotion/` : vérifier visuellement quelques images d'un rendu de test.
