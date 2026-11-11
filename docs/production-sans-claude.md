# Production sans Claude (IA gratuite + GitHub Actions)

> **Relève (choix de l'utilisateur, 09/11/2026)** : Claude fabrique les vidéos tant qu'il reste du quota (5:47 et
> 14:47, il réserve son créneau dans `queue/claude-en-cours.json`). À 6:47 et 15:47, GitHub Actions ne produit
> avec les IA gratuites que si le prochain créneau n'a ni vidéo prête dans `queue/` ni réservation de Claude de
> moins de 4 h. Le bouton « Run workflow » (lancement à la main) produit toujours. Limite : la publication
> Metricool passe par Claude ; quota à zéro, les vidéos attendent dans la file jusqu'au retour du quota.

Choix de l'utilisateur le 09/11/2026 : les vidéos ne sont plus fabriquées par des sessions Claude (quota
hebdomadaire), mais par une IA gratuite, avec **le même studio et les mêmes règles** :

| Étape | Qui la fait maintenant |
|---|---|
| Sujet, brief, faits vérifiés | le studio (code), comme avant |
| IA utilisée | par défaut **GitHub Models**, gratuit et inclus dans GitHub (ChatGPT GPT-4.1, puis GPT-4.1 mini, GPT-4o mini si le quota du jour est atteint), sans clé ; Claude n'y est pas. Une clé Google AI Studio ou FreeLLMAPI peut le remplacer |
| Script | l'IA gratuite (`src/auto/writer.ts`), refusé et renvoyé tant que le contrôleur (`script:check`) trouve une erreur ; checklist viralité visée : 10/12 |
| Voix « Claire », séquences, montage, rendu, contrôles techniques | le studio (code), comme avant |
| Relecture indépendante (images regardées) | l'IA gratuite avec images (`src/auto/reviewer.ts`), consigne `docs/relecteur.md`, relecteur noté `independent-llm` |
| Décision de publier | plus de note minimum (choix de l'utilisateur le 09/11/2026) : la relecture doit juger la vidéo **cohérente** (depuis le 11/11/2026, la « bonne qualité » est affichée mais ne bloque plus), et tous les contrôles obligatoires restent exigés (mention « Publicité », faits vérifiés, droits, son, format) ; la note sur 100 reste affichée, à titre indicatif |
| Corrections | jusqu'à 2 reprises automatiques à partir de la relecture |
| Musique « All For Nothing » | ajoutée si le lien privé `STUDIO_MUSIC_URL` est fourni ; jamais copiée dans le dépôt |
| Publication Metricool | la seule partie qui demande encore Claude (le connecteur Metricool n'existe que là) : une courte tâche à 9:35 et 19:35 |

Commande unique : `npm run studio -- auto` (tout s'enchaîne). Elle tourne chaque jour à 5:47 et 14:47 (heure de Paris
en hiver) dans GitHub Actions (`.github/workflows/production-auto.yml`), gratuit pour un dépôt public. Une vidéo
prête est déposée dans `queue/<runId>.json` avec son créneau (10:00 ou 20:00) ; son MP4 est en ligne dans `videos/`
le temps que Metricool le copie, puis retiré automatiquement 6 h après le créneau.

## Consignes de l'utilisateur pour l'IA gratuite (09/11/2026)

1. **Des vidéos cohérentes** : un seul sujet, chaque scène montre ce que dit sa phrase, chaque chiffre dit est
   celui affiché et vérifié ; la relecture refuse (`coherent: false`) tout passage qui ne suit pas.
2. **S'inspirer énormément des vidéos faites par Claude** : les scripts publiés sont dans `docs/exemples/`
   (2026-11-07-a « formules », 2026-11-06-b « edit ») et sont donnés au rédacteur comme modèles (ton, structure,
   preuves à l'écran) ; la relecture compare à ce niveau (`goodQuality: false` si nettement en dessous).

## IA utilisée (constat du 09/11/2026)

GitHub Models est essayé en premier, mais répond « OK » en texte au lieu d'une réponse d'IA ; le studio passe
alors à **Pollinations** (gratuit, sans compte : modèle `openai`, `mistral` en secours), limité à une réponse
toutes les 45 s par adresse : le studio espace ses demandes. Une clé gratuite Pollinations (enter.pollinations.ai)
ou une clé Google AI Studio (secret `STUDIO_LLM_API_KEY` + variable `STUDIO_LLM_BASE_URL`) lève cette limite.

## À faire une seule fois (sur github.com, dépôt `businebile-png/video-`)

1. **Lancement planifié** : GitHub ne lance les tâches planifiées que depuis la branche par défaut
   (`claude/kind-euler-t08y5a`) : le fichier `.github/workflows/production-auto.yml` y a été copié le 09/11/2026 ;
   à recopier si on le modifie (ou choisir `claude/serene-maxwell-pdm5wr` comme branche par défaut).
2. **Secrets** : Settings → Secrets and variables → Actions → New repository secret :
   - `PIXABAY_API_KEY` (obligatoire) : la clé Pixabay déjà utilisée par le studio (pixabay.com/api/docs, une fois connecté).
   - `STUDIO_LLM_API_KEY` (facultatif) : sans elle, l'IA est GitHub Models (gratuit, aucune clé). Avec une clé
     Google AI Studio (aistudio.google.com → Get API key), le studio utilise `gemini-2.5-flash` (limites plus larges).
   - `STUDIO_MUSIC_URL` (facultatif) : un lien de téléchargement direct de la chanson (par exemple un lien Dropbox
     terminé par `?dl=1`). Sans lui, les vidéos partent sans musique.
3. **Avec FreeLLMAPI au lieu de Google** (facultatif) : héberger FreeLLMAPI sur une adresse joignable depuis
   internet, puis, dans Settings → Secrets and variables → Actions → Variables : `STUDIO_LLM_BASE_URL` =
   `https://<adresse>/v1`, `STUDIO_LLM_MODEL` = `auto:smartest`, `STUDIO_LLM_VISION_MODEL` = un modèle qui lit
   les images (par exemple `gemini-2.5-flash`), et le secret `STUDIO_LLM_API_KEY` = la clé unifiée FreeLLMAPI.
   Une installation FreeLLMAPI sur un téléphone ou un ordinateur personnel n'est pas joignable par GitHub.
4. **Essai** : onglet Actions → « Production automatique (sans Claude) » → Run workflow. Compte rendu (script,
   relecture, note, planche) dans l'artefact « compte-rendu » de l'exécution.

## Publication (la seule partie avec Claude)

Le connecteur Metricool n'existe que dans une conversation Claude ouverte par l'utilisateur. Pour dépenser le
moins de quota possible, la tâche de publication doit vivre dans une **petite conversation dédiée** : ouvrir une
nouvelle conversation Claude Code sur ce dépôt (avec Metricool connecté) et écrire :
« Crée la tâche de publication décrite dans docs/production-sans-claude.md ». La session crée alors, liée à
elle-même (mode par défaut de create_trigger, sans `persistent_session_id`), la tâche
« Publication Metricool (vidéos produites sans Claude) » : `CRON_TZ=Europe/Paris 35 9,19 * * *`, avec la consigne
ci-dessous. Puis désactiver l'ancienne tâche « Programmation automatique Systeme.io » si elle est encore active.

```
Publication automatique (une vidéo à 10:00 et une à 20:00, Europe/Paris, TikTok et Instagram, seulement les vidéos
dont score.decision vaut « publishable »). Les vidéos sont produites sans Claude par GitHub Actions et attendent dans
queue/ (branche claude/serene-maxwell-pdm5wr du dépôt public businebile-png/video-). Ne produis rien, ne modifie
aucun fichier. Sois bref et économe. Réponds en français.
1. curl -s "https://api.github.com/repos/businebile-png/video-/contents/queue?ref=claude/serene-maxwell-pdm5wr",
   télécharge chaque JSON (download_url). Créneau = le prochain parmi 10:00 et 20:00 aujourd'hui (dans ~25 min).
   Prends l'entrée dont autoSlot.iso est ce créneau, à défaut la plus ancienne dont le créneau n'est pas passé de
   plus de 6 h. Aucune : réponds « Aucune vidéo prête pour HH:MM » et arrête-toi.
2. Contrôles, sinon rien n'est publié : score.decision = « publishable » ; toutes les score.gates ok ; chaque posts[].text commence
   par « Publicité » ; media.publicUrl répond 200 (curl -sI) ; posts contient tiktok et instagram.
3. Panneau https://claude.ai/artifact/PHv2PwELy8staCztefioMr (ArtifactData) : get videos/<runId> ; déjà
   « programmee » ou « publiee » → arrête-toi. Sinon set videos/<runId> avec l'entrée (status « prete »).
4. Metricool (marque 7791839, Europe/Paris) : getBrandSettings ; getScheduledPosts du jour (aucun autre post à cette
   heure sur le même réseau) ; createScheduledPost par réseau connecté avec info = posts[réseau].info, publicationDate
   et date = le créneau, autoPublish true, draft false, tiktokData.title rempli ; vérifier le média copié
   (static.metricool.com).
5. ArtifactData update videos/<runId> : status « programmee », autoSlot réel, publications.<réseau> = {status
   « scheduled », scheduledFor, delivery « auto », postId, uuid, plannerUrl, contentSha256 = media.sha256, at,
   permalink null, confirmedAt null}, decision {action « auto », at, notes « Publication automatique (vidéo produite
   sans Claude) »}.
6. Fiches « programmee » dont l'heure est passée : si Metricool dit PUBLISHED avec un lien public → « publiee »
   (permalink, confirmedAt).
7. Une ligne de compte rendu. Jamais une vidéo non « publishable », jamais deux vidéos sur un créneau, jamais « publiée » sans confirmation.
```

## Ce qui change honnêtement

- Une IA gratuite écrit et relit moins finement que Claude. Il n'y a plus de note minimum : une vidéo part dès que
  la relecture la juge cohérente (dans le doute, elle la refuse et la vidéo est corrigée), et les
  contrôles obligatoires (légaux et techniques) bloquent toujours.
- Le panneau montre une vidéo dès que la tâche de publication l'y dépose (avant, la production l'y mettait).
- L'apprentissage sur les statistiques (temps regardé, partages) reste dans le panneau ; la production GitHub ne
  le lit pas encore.
