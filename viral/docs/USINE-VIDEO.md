# Usine vidéo et moteur audio

L'usine fabrique des vidéos verticales (et carrées ou horizontales) de bout en bout, sans rien inventer :
**recherche → analyse → concept → script → voix → visuels → montage → sous-titres → contrôle qualité →
programmation → publication → analyse des résultats.**

## En une commande

```bash
npm run viral -- factory:run --account tiktok-12eure21 --quantity 100            # 100 vidéos, formats choisis par la machine
npm run viral -- video:new --account tiktok-12eure21 --format educatif --duration 30 --voice claire --visuals stock
npm run viral -- factory:status            # où en est chaque vidéo
npm run viral -- factory:resume <lot>      # reprend un lot arrêté là où il était
```

Le tableau de bord local (`npm run dashboard`) fait la même chose depuis la page **Vidéos** (formulaire « Nouvelle
production », lecteur vidéo, contrôle qualité, droits, validation, programmation, paquet manuel) et la page
**Audio Studio** (voix, musique, effets, sous-titres, compte par compte).

## Les étapes d'une vidéo

| Étape | Ce qui se passe | Où |
|---|---|---|
| Script | Contenu de la bibliothèque vérifiée ou d'une IA (faits contrôlés), réécrit pour la rétention : accroche dite dans les 3 premières secondes, sujet annoncé, points de plus en plus utiles, « Et le plus important », conclusion, appel à l'action du réseau. Rien n'est inventé pour allonger : si le contenu vérifié est court, la vidéo est plus courte et le dit. | `src/video/script.ts` |
| Voix | Claire ou Hugo (Chatterbox, naturelles), Siwis, Hugo rapide et 10 voix anglaises, espagnoles, italiennes et portugaises (Kokoro), phrase par phrase avec pauses naturelles, réglage de vitesse, de ton et d'intonation. Chaque prise est réécoutée par faster-whisper (mots mal dits = nouvelle prise chez Claire et Hugo) qui donne aussi l'instant exact de chaque mot. | `src/video/voice.ts` |
| Visuels | Animation 3D, plans vidéo Pixabay (licence vérifiée, plans sans personne pour le produit, pertinence par mots-clés), images fixes animées, ou séquences IA (Veo, Runway) quand une clé existe — sinon plans sous licence, signalé. Personnages fictifs dessinés, lèvres calées sur la voix. | `src/video/stock.ts`, `aigen.ts`, `characters.ts` |
| Musique | Musique originale composée note par note dans la catégorie choisie (ou une piste sous licence de la bibliothèque) : batterie qui entre après l'accroche, accents sur chaque coupe, fin sous l'appel à l'action. | `src/video/music.ts`, `music-library.ts` |
| Montage | Frise calée sur la narration, coupes posées sur le temps musical, transitions 3D, sous-titres mot à mot, effets sonores dans les pauses, rendu image par image en parallèle, encodage H.264, son normalisé. | `timeline.ts`, `page.ts`, `render.ts` |
| Contrôle | Fichier, durée, format, sous-titres, synchronisation, son, image, droits, script, doublons, mention « Publicité ». Un seul échec bloque la vidéo. | `src/video/qc.ts` |
| Publication | TikTok et YouTube (Short) par Zernio, Reels et Threads par l'API de Meta (jetons requis), sinon paquet manuel (MP4, couverture, sous-titres, description, droits). Déclarations « contenu de marque » et « contenu généré par IA » cochées. | `src/publish/` |

## Moteur audio

**Voix** (`npm run viral -- audio:voices`, aperçus : `audio:previews`) :

| Voix | Genre | Langue | Moteur | Licence |
|---|---|---|---|---|
| Claire | femme | français (+ anglais, espagnol, italien, portugais, allemand avec accent français) | Chatterbox, local | MIT ; timbre SIWIS (CC BY 4.0) |
| Hugo | homme | idem | Chatterbox, local | MIT ; timbre dérivé de SIWIS, n'imite personne |
| Siwis, Hugo rapide | femme, homme | français | Kokoro, local | Apache-2.0 ; SIWIS (CC BY 4.0) |
| Heart, Michael / Emma, George | femme, homme | anglais américain / britannique | Kokoro, local | Apache-2.0 |
| Dora, Alex / Sara, Nicola / Dora, Alex | femme, homme | espagnol / italien / portugais du Brésil | Kokoro, local | Apache-2.0 |
| ElevenLabs, Google | toutes | multiples | en ligne | seulement si l'offre autorise l'usage commercial (le plan gratuit d'ElevenLabs l'interdit) |

Crédit à conserver (licence CC BY 4.0) : *SIWIS French Speech Synthesis Database (Honnet et al., Idiap /
Université de Genève / Université d'Édimbourg)*.

**Musique** : 13 ambiances originales (cinématique, motivante, mystérieuse, émotionnelle, dynamique, business,
documentaire, suspense, chill, chaleureuse, légère, ludique, calme). En mode automatique, la machine propose 2 ou 3
ambiances selon le format et les mots du script, puis l'apprentissage choisit celle qui retient le mieux sur le
compte. Pistes externes : `music:add <fichier> --license … --proof … --platforms …` ; refusées si non
commerciales, sans preuve, déclarées à Content ID, ou CC BY sans crédit.

**Effets** : 14 effets synthétisés (transitions, mouvements, impacts légers et cinématiques, montée, scintillement,
tic, battement de cœur, glitch, pop, 3 ambiances). Un effet par coupe, dans la pause entre deux phrases ; au moins
0,9 s entre deux effets ; adouci s'il touche un mot.

**Mixage** (FFmpeg) : voix filtrée (coupe-bas, compression douce, de-esser), musique et ambiances baissées
automatiquement sous la voix (compresseur à clé, réglage léger / normal / fort), effets, limiteur, puis
normalisation en deux passes à -14 LUFS, crêtes sous -1,5 dBTP.

**Sous-titres** : mot par mot, phrase par phrase, TikTok, documentaire, minimaliste, cinématique ; police, couleur,
couleur des mots importants (chiffres, marque, mots clés), taille, position, animation (pop, fondu, glisse, rebond,
machine à écrire). Jamais une ligne qui finit sur un petit mot (« de », « la », « pour ») ni qui chevauche une
coupe. Fichiers SRT et WebVTT fournis à côté du MP4.

**Réglages par compte** : `npm run viral -- audio:set <compte> --voice hugo --music-category cinematic
--music-volume 0.25 --captions mot --caption-color "#FFFFFF" --auto false` (ou la page Audio Studio).

## Analyse des vidéos concurrentes

`npm run viral -- intel:videos <réponses.json>` lit les réponses publiques de ScrapeCreators (TikTok, YouTube),
récupérées dans une session Claude par le connecteur Firecrawl ; `intel:video-report` les affiche. Mesuré : durée,
titre, première phrase, ce qui est dit dans les 3 premières secondes (quand les sous-titres publics sont fournis),
type d'accroche, débit de parole, sous-titres, son original ou musique, storytelling, structure, conclusion, appel à
l'action, statistiques. Non mesuré : rythme du montage et style visuel (il faudrait télécharger la vidéo, ce que la
machine ne fait jamais). Les vidéos et textes des concurrents ne sont jamais réutilisés : le contrôle qualité bloque un
texte trop proche.

## Coûts, quotas, erreurs

Les voix locales, la musique, les effets et Pixabay sont gratuits. Chaque appel à un service est journalisé avec son
coût (`video:costs`, page Vidéos). Un lot a un budget pour les services payants (0 € par défaut : rien de payant
n'est appelé). Les erreurs passagères (réseau, limite de débit) sont retentées 3 fois avec une pause croissante ; une
vidéo en échec n'arrête pas le lot ; un seul lot tourne à la fois.

## Temps de production (ce conteneur, 4 processeurs)

Voix Claire ou Hugo : environ 1 minute par phrase. Siwis : quelques secondes par vidéo. Rendu : environ 4 images par
seconde (une vidéo de 30 s ≈ 2 à 4 minutes). 100 vidéos de 30 s avec Claire ≈ une à deux journées de calcul ; avec
Siwis ≈ 5 à 7 heures.
