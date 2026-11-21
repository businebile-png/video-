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
  Choix final de l'utilisateur le 15/11/2026 : **garder Claire** (100 % gratuite, sans compte ni carte). Le
  branchement Google Cloud Text-to-Speech (`docs/voix-google.md`) reste disponible mais inutilisé : ne pas le remettre
  en tête des voix sans nouvelle demande de l'utilisateur (il exige une facturation Google activée).
- Production : **Claude d'abord, IA gratuites en relève** (choix de l'utilisateur le 09/11/2026). À 5:47, la tâche
  « Production Systeme.io — série, 2 vidéos par jour » (`trig_01RNBHFDf7LNerv47ffZzS7Z`, qui réveille la session de la
  régie `session_01N7BpMrqV24PNBWQH4tAsxv` ; une tâche « session neuve » n'aurait ni le dépôt ni `create_session`) lance une session de production Claude (modèle économe) de **deux** vidéos, faites une par une, pour les deux premiers
  créneaux libres à plus de 6 h (demande de l'utilisateur du 21/11/2026). Du 23/11 au 22/12/2026, chaque créneau suit son
  script de la **série de 60 vidéos** (`data/serie.json`, copie du doc https://claude.ai/artifact/ARvQZ1yHphg25qnphZ9Boj :
  `npm run studio -- serie:slot --slot <iso>`, puis `new --category <catégorie> --serie <n>`) ; une démo sans
  enregistrement d'écran de l'utilisateur laisse son créneau à sa vidéo de relève. Hors série, le programme du mois
  (`data/programme.json`, `npm run studio -- programme`). La production réserve son créneau (`queue:claim`) et met sa
  vidéo dans `queue/` (`queue:add`). À 6:47 et 15:47, GitHub Actions (`npm run studio -- auto --if-needed`, IA gratuites :
  GitHub Models puis Pollinations) ne produit que si le créneau n'est ni servi ni réservé (quota de Claude épuisé,
  échec), sans suivre la série : voir `docs/production-sans-claude.md`. Les anciennes tâches de production de la session
  principale (`trig_011uUZC54x62D6LBd5XAGJWq`, `trig_01CK4GpGHEs6z5W7xKf2Lo8C`) restent désactivées.
- Publication : 100 % automatique, sans validation (choix de l'utilisateur le 08/11/2026) : **deux vidéos par jour, à
  10:00 et 20:00** (demande de l'utilisateur du 21/11/2026, qui remplace la vidéo unique de 20:00 ; `postTimes` de
  `config/studio.json`, aucun créneau avant `publish.notBefore`, le début de la série), sur TikTok, Instagram, YouTube
  (Short) et Threads. Depuis le 21/11/2026, TikTok et YouTube passent par **Zernio**
  (connecteur « zernio », gratuit pour ces 2 comptes, sans limite de publications ; déclarations « contenu de marque » et
  « IA » cochées) et Instagram et Threads par Metricool (formule gratuite : 20 publications par mois ; au-delà, « à
  poster soi-même » depuis le panneau). L'utilisateur ne peut pas payer de formule. (YouTube : titre « Publicité · … », description = légende TikTok, voix de synthèse déclarée ;
  Threads : légende raccourcie à 500 caractères par `condenseForThreads`). Légendes : « Publicité · Systeme.io » en tête,
  sans phrase sur la commission (demande de l'utilisateur du 21/11/2026 ; « Publicité » reste obligatoire). Pas de note minimum (choix de l'utilisateur le
  09/11/2026, `publish.decisionRule: "coherence"`) : la vidéo part si la relecture la juge cohérente (depuis le
  11/11/2026, la « bonne qualité » est affichée mais ne bloque plus) et si tous les contrôles obligatoires sont validés
  (mention « Publicité », faits, droits, son, aucun problème bloquant ni doute factuel à la relecture) ; tâche courte à 13:35 dans une conversation Claude qui a le connecteur Metricool (la formule gratuite de Metricool
  plafonne à 20 publications par mois) ; jamais deux
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
