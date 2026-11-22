# Publication Instagram et Threads par les API de Meta (gratuit)

Depuis le 22/11/2026 (demande de l'utilisateur : « automatiquement, mais gratuitement »), Instagram (Reels) et Threads
peuvent être publiés **directement** avec les API officielles de Meta, sans passer par Metricool (quota gratuit de
20 publications par mois, épuisé en novembre) ni par Zernio (carte demandée au-delà de 2 comptes). TikTok et YouTube
restent sur Zernio (2 comptes gratuits, publications illimitées).

## Fonctionnement

- `src/publish/meta.ts` lit `queue/*.json` (les vidéos prêtes) et publie, au créneau de la vidéo (10:00 ou 20:00), le Reel
  Instagram puis le post Threads, avec la légende déjà préparée (`posts[instagram]`, `posts[threads]`, mention
  « Publicité · Systeme.io » en tête, déclaration « contenu IA » cochée côté Instagram et Threads).
- `.github/workflows/publier-meta.yml` le lance par GitHub Actions (gratuit, indépendant du quota de Claude) à 9:50 et
  19:50 (il attend l'heure du créneau), avec une reprise à 12:15 et 22:15 en cas d'échec. **Ce fichier doit rester sur la
  branche par défaut du dépôt** (`claude/kind-euler-t08y5a`) : GitHub n'exécute les planifications que depuis elle.
- Meta télécharge elle-même la vidéo à une adresse publique (le téléversement direct exige « Facebook Login for Business »,
  hors de cette formule gratuite). GitHub brut sert les MP4 en `application/octet-stream`, que Meta peut refuser, et jsDelivr
  ne sert pas les fichiers de plus de 20 Mo. Le publieur teste donc, avant d'appeler Meta, trois adresses épinglées sur le
  commit récupéré (jsDelivr, githack, GitHub brut), ne garde que celles qui répondent avec un vrai type vidéo (`video/mp4`)
  et passe à la suivante si Meta refuse la première. Le mode « verifier » affiche ces tests pour la prochaine vidéo.
- Contrôles refaits à la publication : vidéo « publishable », légende commençant par « Publicité », créneau atteint et
  dépassé de moins de 5 h, 3 essais au plus par réseau. Une vidéo n'est jamais publiée deux fois (`data/meta-publications.json`).
- Résultat de chaque publication (identifiant, adresse du post) : `data/meta-publications.json`, commité par le workflow.
  La tâche de publication de 13:35 s'en sert pour passer les fiches du panneau à « publiée » (la plateforme a confirmé).

## Mise en route (une fois, environ 20 minutes)

1. https://developers.facebook.com/apps → **Créer une app** → cas d'usage **Autre** → type **Business** → nom et e-mail.
2. Produit **Instagram** → **Configurer** → « API setup with Instagram login » → ajouter le compte Instagram (professionnel,
   public) → **Generate token** → copier le jeton (valable 60 jours).
3. Pour Threads : app avec le cas d'usage **Accéder à l'API Threads** ; **Rôles de l'app → Ajouter des personnes → Testeur
   Threads** ; accepter l'invitation dans Threads (Paramètres → Compte → Autorisations du site web → Invitations) ; générer
   le jeton utilisateur dans les réglages du cas d'usage (permissions `threads_basic` et `threads_content_publish`).
4. Dépôt GitHub → Settings → Secrets and variables → Actions → **New repository secret** : `INSTAGRAM_ACCESS_TOKEN` et
   `THREADS_ACCESS_TOKEN`. Ne jamais coller un jeton dans une conversation ni dans le dépôt.
5. Onglet Actions → « Publication Instagram et Threads (API Meta) » → Run workflow → mode `verifier` : le journal affiche
   `✓ instagram : @compte` et `✓ threads : @compte` sans rien publier.
6. Une fois les jetons contrôlés, mettre `"actif": true` dans `data/meta-publications.json` : dès lors Instagram et Threads
   ne sont plus programmés sur Metricool ni Zernio (les publications Metricool déjà créées pour ces réseaux passent en
   brouillon, sinon doublon).

## Entretien

- Les jetons durent **60 jours** : en générer de nouveaux (étapes 2 et 3) et remplacer les secrets avant l'échéance
  (jetons créés le 22/11/2026 → à renouveler avant le 20/01/2027).
- Heure d'été (à partir du 28/03/2027) : décaler les `cron` du workflow d'une heure en arrière (8:50 → 7:50 UTC, etc.).
- Laisser une vidéo de côté pour un réseau : ajouter dans `data/meta-publications.json`
  `"<runId>": {"instagram": {"status": "skipped", "at": "<iso>", "reason": "…"}}`.
- Essai à blanc local : `npm run studio -- meta:publish publier --simuler --maintenant 2026-11-23T20:05:00+01:00`.
- Limites de Meta : 100 publications par 24 h sur Instagram, 250 sur Threads (loin de notre usage).
- Pas de label « partenariat rémunéré » par cette API : la mention « Publicité » reste dans la vidéo et en tête de légende.
