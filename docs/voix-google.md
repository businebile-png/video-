# Voix Google (à la place de Claire)

Choix de l'utilisateur le 15/11/2026 : remplacer la voix « Claire » par la voix « Google français 5 (Natural) »
entendue dans son navigateur, pour toutes les nouvelles vidéos (« fais tout, je t'autorise »).

## Pourquoi pas la voix du navigateur elle-même

« Google français 5 (Natural) » est une voix de lecture du navigateur (Chrome) : elle ne s'entend que sur l'appareil,
le studio (qui fabrique les vidéos sur un serveur) ne peut pas l'enregistrer, et aucune licence ne permet de la reprendre
dans des publicités. Google vend ses voix françaises naturelles dans un service professionnel :
**Google Cloud Text-to-Speech**. La correspondance exacte avec « Google français 5 » n'est pas publiée : l'utilisateur
choisit à l'oreille, dans le panneau, parmi les voix françaises du service (même script pour toutes).

## Licence et prix (vérifiés le 15/11/2026 sur les pages officielles)

- **Classement** (https://cloud.google.com/terms/services) : Text-to-Speech est rangé dans les « Pre-Trained APIs »
  (services d'IA/ML), **pas** dans les « Generative AI Services ».
- **Conditions** (https://cloud.google.com/terms/service-terms, version du 2 avril 2026) : aucune section propre à
  Text-to-Speech. Les restrictions des services d'IA (section 17) interdisent seulement d'utiliser l'audio pour créer un
  produit concurrent ou pour entraîner un modèle semblable à celui de Google. Aucune clause trouvée qui limite l'usage
  publicitaire ou impose une mention ; le studio indique quand même « Voix de synthèse IA » dans la légende et coche le
  contenu IA sur TikTok et Instagram.
- **Prix** (https://cloud.google.com/text-to-speech/pricing) : chaque mois, de 0 à 1 million de caractères gratuits
  pour les voix Neural2 (puis 16 $ le million), Chirp 3 HD (puis 30 $) et Studio (puis 160 $). « You must enable
  billing to use Text-to-Speech, and will be automatically charged if your usage exceeds the number of free characters
  allowed per month. »
- **Consommation du studio** : environ 500 caractères par vidéo (un peu plus avec les reprises), soit environ 30 000 par
  mois pour deux vidéos par jour. Le studio s'arrête de lui-même à **500 000 caractères par mois**
  (`voice.google.monthlyCharacterLimit`, compteur dans `data/voice-usage.json`) et reprend alors Claire.

## Mise en route

1. L'utilisateur, une fois : console.cloud.google.com → créer un projet → Facturation (carte bancaire) → activer
   « Cloud Text-to-Speech API » → API et services → Identifiants → Créer des identifiants → Clé API, limitée à
   « Cloud Text-to-Speech API ».
2. La clé est saisie dans le formulaire sécurisé de Claude Code (jamais dans la conversation ni dans le dépôt) : elle
   devient un secret réseau de l'environnement, ajouté par le proxy dans l'en-tête `X-Goog-Api-Key` pour
   `texttospeech.googleapis.com`. Sur GitHub Actions, un secret `GOOGLE_TTS_API_KEY` ferait de même ; sans lui, la
   relève gratuite garde Claire.
3. Écoute : `npm run studio -- voice:audition --provider google` (un essai par voix française dans
   `runs/_audition/`), puis les essais vont dans le panneau (Réglages → Voix off, fiches `voices/<voix>` avec
   `provider: "google"`, `primary: true`).
4. L'utilisateur approuve une voix dans le panneau ; `panel:import` (au début de chaque production) la met en tête des
   voix approuvées. À la main : `npm run studio -- voice:approve <voix> --provider google --name "…"
   --credit "Voix de synthèse IA (Google)."`.

## Fonctionnement

- Avant chaque voix off, le studio vérifie gratuitement que Google répond (liste des voix) et que le plafond du mois
  n'est pas atteint ; sinon, ou si Google échoue pendant la génération, la vidéo est faite avec Claire.
- Les sous-titres sont calés sur l'audio réel (transcription locale faster-whisper), comme pour Claire ; mêmes contrôles
  de prononciation, de débit et de pauses.
- La légende crédite la voix qui a vraiment parlé : « Voix de synthèse IA (Google). » ou, pour Claire, la mention SIWIS.
